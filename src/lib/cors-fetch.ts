// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
/**
 * CORS-safe fetch wrapper
 *
 * 自动检测运行环境：
 * - Electron 桌面模式 → 通过主进程 net:proxy-fetch IPC 转发，绕过 Chromium CORS
 * - 浏览器开发模式   → 通过 Vite 开发服务器 /__api_proxy?url=... 代理转发
 * - 浏览器生产模式   → 直接 fetch()（需后端/Nginx 提供反向代理）
 */

/** 检测是否在 Electron 环境中运行 */
function isElectron(): boolean {
  return !!(
    typeof window !== 'undefined' &&
    (window as any).netProxy &&
    typeof (window as any).netProxy.fetch === 'function'
  );
}

/** 检测是否在 Vite 开发服务器中运行 */
function isViteDev(): boolean {
  return import.meta.env?.DEV === true;
}

/**
 * 哪些域应该走主进程代理（绕过 CORS）
 * 同源 / 自家中转站不需要代理；第三方原生 API 域需要。
 */
function shouldUseMainProxy(targetUrl: string): boolean {
  try {
    const u = new URL(targetUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost/');
    // 同源 / file: / 本地 → 直连
    if (u.protocol === 'file:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') return false;
    // 已知会拦截 CORS 的第三方原生 API
    const corsBlockedHosts = [
      /\.volces\.com$/i,            // 火山方舟（ark.cn-beijing.volces.com）
      /\.cn-beijing\.volces\.com$/i,
      /^api\.openai\.com$/i,
      /\.googleapis\.com$/i,
      /generativelanguage\.googleapis\.com$/i,
      /\.anthropic\.com$/i,
      /\.x\.ai$/i,
      /\.bytedanceapi\.com$/i,
      /\.aliyuncs\.com$/i,
      /\.bce\.baidu\.com$/i,
      /\.zhipuai\.cn$/i,
      /\.deepseek\.com$/i,
      /\.moonshot\.cn$/i,
      /\.minimaxi\.com$/i,
      /\.kling\.cn$/i,
      /\.runwayml\.com$/i,
      /\.lumalabs\.ai$/i,
      /\.replicate\.com$/i,
      /\.runninghub\.cn$/i,
    ];
    return corsBlockedHosts.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** 构造一个 Response 对象用代理结果 */
function buildResponseFromProxy(result: {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}): Response {
  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
}

/** 把 RequestInit.headers / body 序列化成主进程能接受的字符串形式 */
async function serializeForProxy(init?: RequestInit): Promise<{
  method: string;
  headers: Record<string, string>;
  body?: string;
  bodyIsBase64?: boolean;
}> {
  const method = (init?.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) headers[k] = v;
    } else {
      Object.assign(headers, init.headers as Record<string, string>);
    }
  }
  if (init?.body == null || method === 'GET' || method === 'HEAD') {
    return { method, headers };
  }
  const body = init.body;
  if (typeof body === 'string') {
    return { method, headers, body };
  }
  if (body instanceof ArrayBuffer) {
    const b64 = btoa(String.fromCharCode(...new Uint8Array(body)));
    return { method, headers, body: b64, bodyIsBase64: true };
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    const u8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return { method, headers, body: btoa(s), bodyIsBase64: true };
  }
  if (body instanceof Blob) {
    const buf = await body.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return { method, headers, body: b64, bodyIsBase64: true };
  }
  if (body instanceof FormData) {
    // FormData 暂不通过主进程代理；调用方应避免
    throw new Error('corsFetch 主进程代理暂不支持 FormData，请直接 fetch 或先转 Blob');
  }
  // 兜底
  return { method, headers, body: String(body) };
}

/**
 * CORS 安全的 fetch 封装
 */
export async function corsFetch(
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const targetUrl = url.toString();

  // Electron：第三方原生域走主进程代理
  if (isElectron() && shouldUseMainProxy(targetUrl)) {
    const np = (window as any).netProxy as {
      fetch: (req: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        bodyIsBase64?: boolean;
        timeoutMs?: number;
      }) => Promise<{ ok: boolean; status: number; statusText: string; headers: Record<string, string>; body: string }>;
    };
    const ser = await serializeForProxy(init);
    const result = await np.fetch({
      url: targetUrl,
      method: ser.method,
      headers: ser.headers,
      body: ser.body,
      bodyIsBase64: ser.bodyIsBase64,
      // 视频生成提交/轮询可能较慢，给充足超时
      timeoutMs: 5 * 60_000,
    });
    return buildResponseFromProxy(result);
  }

  // Electron 同源/自家中转 或 浏览器生产 → 直连
  if (isElectron() || !isViteDev()) {
    return fetch(targetUrl, init);
  }

  // 浏览器开发模式：走 Vite 代理
  const proxyUrl = `/__api_proxy?url=${encodeURIComponent(targetUrl)}`;

  const proxyHeaders = new Headers(init?.headers);
  const originalHeaders: Record<string, string> = {};
  proxyHeaders.forEach((value, key) => {
    originalHeaders[key] = value;
  });

  const proxyInit: RequestInit = {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-proxy-headers': JSON.stringify(originalHeaders),
    },
  };

  return fetch(proxyUrl, proxyInit);
}
