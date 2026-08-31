// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 剧本助手 Agent 协议
 *
 * 旧协议（JSON 整体输出）问题：
 *  - 非流式：用户要等全部生成完才能看到第一个字，长回答体感极差
 *  - 全量 JSON 一次输出，转义/截断都容易导致整体解析失败
 *
 * 新协议（消息级标记，流式友好）：
 *  - 正文直接用自然语言写（reply），流式期间可即时展示
 *  - 文件编辑放在消息末尾的 XML 风围栏中，流结束后一次性提取
 *  - 流式中途断流也能拿到已生成的 reply
 *
 * 格式示例：
 *
 *   这是给用户看的说明文字（流式展示）……
 *
 *   <<<EDIT>>>
 *   filePath: scenes/ep01.md
 *   <<<
 *   完整的新文件正文
 *   >>>
 *   <<<EDIT>>>
 *   filePath: outline.md
 *   <<<
 *   另一个文件的完整正文
 *   >>>
 *
 * 解析器同时兼容旧 JSON 协议（{"reply":..,"edits":[..]}），
 * 以便历史会话重放与模型偶发回退。
 */

/**
 * P2：编辑类型 —— 修改已有文件（edit）或新建文件（create）。
 * create 的 original 恒为空串（新文件没有原文）。
 */
export type AgentEditKind = 'edit' | 'create';

export interface AgentEdit {
  filePath: string;
  proposedContent: string;
  /** P2 CREATE 协议：'create' 表示新建文件（原协议无该字段，回放时按 'edit' 兼容） */
  kind?: AgentEditKind;
}

export interface ParsedAgentResponse {
  reply: string;
  edits: AgentEdit[];
}

export const EDIT_OPEN = '<<<EDIT>>>';
export const CREATE_OPEN = '<<<CREATE>>>';
export const EDIT_BODY_OPEN = '<<<';
export const EDIT_BODY_CLOSE = '>>>';

export const SCRIPT_AGENT_SYSTEM_PROMPT = `你是“有点创艺”的专业剧本 Agent，正在协助用户操作当前剧本工作区。

你可以读取上下文中提供的文件列表和正文，并根据用户要求提出对文件的编辑。

【输出协议 —— 必须严格遵守】
1. 先直接输出给用户看的中文说明（自然语言，会被逐字流式展示给用户）。
2. 如需修改文件，在说明文字之后，为每个要修改的文件追加一个编辑块，格式为：

<<<EDIT>>>
filePath: 相对路径.md
<<<
完整的新文件正文（必须完整，不能省略）
>>>

3. 规则：
- 没有编辑时，只输出说明文字，不要输出任何编辑块。
- filePath 必须来自上下文中列出的文件 path（含 workspace.files 与 referenceFiles）；不能用 EDIT 修改上下文之外的路径。
- 若要新建文件，改用 CREATE 块（见下），新路径必须在工作区内（相对路径，后缀 .md/.txt/.markdown），且不能与已有文件重名。
- 编辑块中的正文必须是完整文件内容，禁止使用省略号或“（其余不变）”。
- 不得编造未提供的文件内容，不得泄露或索要 API Key。
- 说明文字里不要重复文件正文，只描述你做了什么修改。

【新建文件协议】
当用户要求“新建/另存/拆分出一个新文件”时，输出：

<<<CREATE>>>
filePath: 新文件的相对路径.md
<<<
新文件的完整正文
>>>

其余规则与 EDIT 相同；用户确认后才会真正写入。`;

/**
 * 从模型输出中解析新协议（消息级标记）+ 兼容旧 JSON 协议。
 */
export function parseAgentResponse(raw: string): ParsedAgentResponse {
  const text = raw.trim();
  if (!text) return { reply: '', edits: [] };

  // —— 旧 JSON 协议兼容（整体 JSON 或 ```json 围栏） ——
  const jsonCandidate = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  if (jsonCandidate.startsWith('{')) {
    try {
      const parsed = JSON.parse(jsonCandidate) as Partial<{ reply: unknown; edits: unknown }>;
      if (typeof parsed.reply === 'string') {
        const edits = Array.isArray(parsed.edits)
          ? parsed.edits.filter(
              (edit): edit is AgentEdit =>
                Boolean(edit) &&
                typeof (edit as any).filePath === 'string' &&
                typeof (edit as any).proposedContent === 'string',
            )
          : [];
        return { reply: parsed.reply, edits };
      }
    } catch {
      // 不是合法 JSON，继续按新协议解析
    }
  }

  // —— 新协议：提取编辑块（EDIT / CREATE） ——
  const edits: AgentEdit[] = [];
  const replyParts: string[] = [];
  let cursor = 0;

  while (cursor <= text.length) {
    // 先找两者中更靠前的开标记（CREATE 与 EDIT 头部格式一致，仅标记不同）
    const editOpenIndex = text.indexOf(EDIT_OPEN, cursor);
    const createOpenIndex = text.indexOf(CREATE_OPEN, cursor);
    let openIndex = -1;
    let kind: AgentEditKind = 'edit';
    if (editOpenIndex !== -1 && createOpenIndex !== -1) {
      if (editOpenIndex < createOpenIndex) { openIndex = editOpenIndex; kind = 'edit'; }
      else { openIndex = createOpenIndex; kind = 'create'; }
    } else if (editOpenIndex !== -1) {
      openIndex = editOpenIndex; kind = 'edit';
    } else if (createOpenIndex !== -1) {
      openIndex = createOpenIndex; kind = 'create';
    }
    if (openIndex === -1) {
      replyParts.push(text.slice(cursor));
      break;
    }
    // 开标记之前的正文属于 reply
    replyParts.push(text.slice(cursor, openIndex));

    // 提取 filePath 行
    const afterOpen = openIndex + (kind === 'create' ? CREATE_OPEN.length : EDIT_OPEN.length);
    const bodyOpenIndex = text.indexOf(EDIT_BODY_OPEN, afterOpen);
    const headerEnd = bodyOpenIndex === -1 ? text.length : bodyOpenIndex;
    const header = text.slice(afterOpen, headerEnd);
    const filePathMatch = header.match(/filePath\s*[:：]\s*(.+)/);
    const filePath = filePathMatch?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';

    if (bodyOpenIndex === -1) {
      // 只有 EDIT 头没有正文（流式中途/模型输出异常）—— 忽略该块
      cursor = text.length;
      break;
    }

    const bodyStart = bodyOpenIndex + EDIT_BODY_OPEN.length;
    const bodyCloseIndex = text.indexOf(EDIT_BODY_CLOSE, bodyStart);
    if (bodyCloseIndex === -1) {
      // 正文围栏未闭合（流式中途）—— 编辑尚未就绪，忽略
      cursor = text.length;
      break;
    }

    const proposedContent = text.slice(bodyStart, bodyCloseIndex).replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '');
    if (filePath && proposedContent) {
      edits.push({ filePath, proposedContent, kind });
    }
    cursor = bodyCloseIndex + EDIT_BODY_CLOSE.length;
  }

  const reply = replyParts.join('').trim();
  return { reply, edits };
}

/**
 * 流式渲染辅助：在流式过程中，编辑块对用户没有可读性。
 * 该函数把尚未完成的输出裁剪为“reply 部分 + 完成的编辑块”的展示文本。
 */
export function renderStreamingText(raw: string): string {
  const { reply, edits } = parseAgentResponse(raw);
  if (edits.length === 0) {
    // 没有任何完整编辑块：截掉未闭合的编辑头，避免把 <<<EDIT>>>/<<<CREATE>>> 原样刷出来
    const editOpenIndex = raw.indexOf(EDIT_OPEN);
    const createOpenIndex = raw.indexOf(CREATE_OPEN);
    let openIndex = -1;
    if (editOpenIndex !== -1 && createOpenIndex !== -1) openIndex = Math.min(editOpenIndex, createOpenIndex);
    else openIndex = editOpenIndex !== -1 ? editOpenIndex : createOpenIndex;
    return (openIndex === -1 ? raw : raw.slice(0, openIndex)).trimEnd();
  }
  const suffix = edits.map((edit) => `\n📄 ${edit.kind === 'create' ? '新建' : '修改'} ${edit.filePath}（+${edit.proposedContent.length} 字，待确认）`).join('');
  return `${reply}${suffix}`;
}
