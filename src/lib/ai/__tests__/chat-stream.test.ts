import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSSEDelta, callChatAPIStream } from '../chat-stream';

/** 构造一个 SSE ReadableStream（Node 环境下 Response 可用） */
function sseResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    ...init,
  });
}

describe('parseSSEDelta', () => {
  it('解析普通 content delta', () => {
    const line = 'data: ' + JSON.stringify({
      choices: [{ delta: { content: '你好' }, index: 0 }],
    });
    const result = parseSSEDelta(line);
    expect(result?.text).toBe('你好');
    expect(result?.reasoning).toBe('');
  });

  it('解析 reasoning_content delta', () => {
    const line = 'data: ' + JSON.stringify({
      choices: [{ delta: { reasoning_content: '思考中' } }],
    });
    const result = parseSSEDelta(line);
    expect(result?.reasoning).toBe('思考中');
    expect(result?.text).toBe('');
  });

  it('[DONE] 返回 null', () => {
    expect(parseSSEDelta('data: [DONE]')).toBeNull();
  });

  it('空行 / 非 data 行返回 null', () => {
    expect(parseSSEDelta('')).toBeNull();
    expect(parseSSEDelta(': keep-alive')).toBeNull();
    expect(parseSSEDelta('event: message')).toBeNull();
  });

  it('多模态数组 content 也支持', () => {
    const line = 'data: ' + JSON.stringify({
      choices: [{ delta: { content: [{ type: 'text', text: '片段' }] } }],
    });
    const result = parseSSEDelta(line);
    expect(result?.text).toBe('片段');
  });
});

describe('callChatAPIStream', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });  const baseOptions = {
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    model: 'test-model',
  };

  it('流式输出聚合为完整文本并逐段回调', async () => {
    (globalThis.fetch as any).mockImplementation(async () => sseResponse([
      'data: ' + JSON.stringify({ choices: [{ delta: { content: '你' } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { content: '好' } }] }) + '\n\n',
      'data: [DONE]\n\n',
    ]));

    const onText = vi.fn();
    const full = await callChatAPIStream('sys', 'user', baseOptions, { onText });

    expect(full).toBe('你好');
    expect(onText).toHaveBeenCalledWith('你', expect.anything());
    expect(onText).toHaveBeenCalledWith('好', expect.anything());

    // 请求体校验：stream: true
    const [, init] = (globalThis.fetch as any).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    // 请求头带 SSE Accept（直连/Vite代理/Electron代理 三种包装方式都兼容）
    const rawHeaders: any = init.headers ?? {};
    const headerText = typeof rawHeaders.get === 'function'
      ? JSON.stringify(Object.fromEntries(rawHeaders.entries()))
      : JSON.stringify(rawHeaders);
    expect(headerText).toContain('text/event-stream');
  });

  it('非 SSE 响应（服务端忽略 stream）回退到整体解析', async () => {
    (globalThis.fetch as any).mockImplementation(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '整体回复' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    const full = await callChatAPIStream('sys', 'user', baseOptions);
    expect(full).toBe('整体回复');
  });

  it('HTTP 错误时抛出异常（非速率限制错误不重试）', async () => {
    (globalThis.fetch as any).mockImplementation(async () => new Response(
      JSON.stringify({ error: { message: 'invalid api key' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(
      callChatAPIStream('sys', 'user', { ...baseOptions }, undefined),
    ).rejects.toThrow();
  });

  describe('2.1 中止传播', () => {
    it('signal 透传到 fetch 请求', async () => {
      (globalThis.fetch as any).mockImplementation(async () => sseResponse([
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n\n',
        'data: [DONE]\n\n',
      ]));

      const controller = new AbortController();
      await callChatAPIStream('sys', 'user', { ...baseOptions, signal: controller.signal });

      const [, init] = (globalThis.fetch as any).mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBe(controller.signal);
    });

    it('读取中 abort：reader 被 cancel，返回已收到的部分文本（不抛错）', async () => {
      // 流永不清空（模拟服务端持续输出），abort 后 reader.cancel() 使 read() 以 done 收尾
      const encoder = new TextEncoder();
      let enqueue: ((chunk: string) => void) | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          enqueue = (chunk) => controller.enqueue(encoder.encode(chunk));
          enqueue('data: ' + JSON.stringify({ choices: [{ delta: { content: '部分' } }] }) + '\n\n');
        },
      });
      (globalThis.fetch as any).mockImplementation(async () => new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }));

      const controller = new AbortController();
      const onText = vi.fn();

      // 收到首个 delta 后延迟 abort（等 read() 循环跑起来）
      setTimeout(() => controller.abort(), 30);

      const full = await callChatAPIStream('sys', 'user', { ...baseOptions, signal: controller.signal }, { onText });

      expect(controller.signal.aborted).toBe(true);
      expect(full).toBe('部分');
      expect(onText).toHaveBeenCalledWith('部分', expect.anything());
    });

    it('请求前已 abort：fetch 拒绝且不重试', async () => {
      const fetchMock = vi.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
      (globalThis.fetch as any).mockImplementation(fetchMock);

      const controller = new AbortController();
      controller.abort();

      await expect(
        callChatAPIStream('sys', 'user', { ...baseOptions, signal: controller.signal }),
      ).rejects.toThrow();

      // AbortError 被重试逻辑短路：只调一次
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
