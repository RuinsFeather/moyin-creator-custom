import { describe, it, expect } from 'vitest';
import {
  EDIT_OPEN,
  parseAgentResponse,
  renderStreamingText,
} from '../agent-protocol';

describe('parseAgentResponse', () => {
  it('解析新协议：回复 + 单个编辑块', () => {
    const raw = [
      '这是给用户的说明。',
      EDIT_OPEN,
      'filePath: scenes/ep01.md',
      '<<<',
      '# 第一集',
      '新的正文内容',
      '>>>',
    ].join('\n');

    const parsed = parseAgentResponse(raw);
    expect(parsed.reply.trim()).toBe('这是给用户的说明。');
    expect(parsed.edits).toHaveLength(1);
    expect(parsed.edits[0].filePath).toBe('scenes/ep01.md');
    expect(parsed.edits[0].proposedContent).toBe('# 第一集\n新的正文内容');
  });

  it('解析新协议：多个编辑块', () => {
    const raw = [
      '两个修改建议。',
      EDIT_OPEN,
      'filePath: a.md',
      '<<<',
      'A 内容',
      '>>>',
      EDIT_OPEN,
      'filePath: b.md',
      '<<<',
      'B 内容',
      '>>>',
    ].join('\n');

    const parsed = parseAgentResponse(raw);
    expect(parsed.edits).toHaveLength(2);
    expect(parsed.edits.map((e) => e.filePath)).toEqual(['a.md', 'b.md']);
  });

  it('兼容旧 JSON 协议', () => {
    const raw = JSON.stringify({
      reply: '旧协议回复',
      edits: [{ filePath: 'old.md', proposedContent: '旧内容' }],
    });
    const parsed = parseAgentResponse(raw);
    expect(parsed.reply).toBe('旧协议回复');
    expect(parsed.edits).toHaveLength(1);
    expect(parsed.edits[0].filePath).toBe('old.md');
  });

  it('兼容带 ```json 围栏的旧协议', () => {
    const raw = '```json\n' + JSON.stringify({ reply: '围栏回复', edits: [] }) + '\n```';
    const parsed = parseAgentResponse(raw);
    expect(parsed.reply).toBe('围栏回复');
    expect(parsed.edits).toHaveLength(0);
  });

  it('未闭合的编辑块（流式中断）被忽略', () => {
    const raw = [
      '部分回复',
      EDIT_OPEN,
      'filePath: unfinished.md',
      '<<<',
      '写到一半',
    ].join('\n');

    const parsed = parseAgentResponse(raw);
    expect(parsed.edits).toHaveLength(0);
  });

  it('中文冒号的 filePath 也能识别', () => {
    const raw = [
      '说明',
      EDIT_OPEN,
      'filePath：cn/file.md',
      '<<<',
      '正文',
      '>>>',
    ].join('\n');
    const parsed = parseAgentResponse(raw);
    expect(parsed.edits[0]?.filePath).toBe('cn/file.md');
  });

  it('纯文本无编辑时原样返回 reply', () => {
    const parsed = parseAgentResponse('只是一段回答，没有任何编辑。');
    expect(parsed.reply).toBe('只是一段回答，没有任何编辑。');
    expect(parsed.edits).toHaveLength(0);
  });
});

describe('renderStreamingText', () => {
  it('流式中：截断首个编辑块标记之后的内容', () => {
    const partial = '回答开头\n' + EDIT_OPEN + '\nfilePath: x.md\n<<<\n写到一半';
    const rendered = renderStreamingText(partial);
    expect(rendered).toContain('回答开头');
    expect(rendered).not.toContain('<<<');
    expect(rendered).not.toContain('filePath');
  });

  it('完整后：显示 reply + 每个编辑的摘要', () => {
    const raw = [
      '全部完成。',
      EDIT_OPEN,
      'filePath: a.md',
      '<<<',
      'AA',
      '>>>',
    ].join('\n');
    const rendered = renderStreamingText(raw);
    expect(rendered).toContain('全部完成。');
    expect(rendered).toContain('a.md');
    expect(rendered).toContain('待确认');
  });

  it('普通文本原样返回', () => {
    expect(renderStreamingText('普通流式文本')).toBe('普通流式文本');
  });
});
