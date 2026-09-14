// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Script syntax parser (剧本六类语法解析器)
 *
 * 对读入的剧本 Markdown 做确定性语法解析，产出带原文偏移与行范围的
 * 有序 token 列表，供后续视觉事件提取与 AI 拆分使用。解析器只负责
 * 分类与保留原文，不做语义猜测；无法识别的内容归入 unknown。
 *
 * 六类语法（+unknown）：
 *   - scene        `## 场次：时间 / 内外景 / 地点`
 *   - action       `△ 描述动作/环境/画面变化`（连续非空文本为续行）
 *   - dialogue     `**角色名**：` 后随非空对白行
 *   - parenthetical `（语气或动作）` / `(语气或动作)` / 角色名后括号
 *   - transition   `【转场：内容】`
 *   - subtitle     `【字幕：内容】`
 *   - comment      `<!-- 创作注释 -->`
 *   - unknown      不符合以上规则的文本
 */

export type ScriptTokenType =
  | 'scene'
  | 'action'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'
  | 'subtitle'
  | 'comment'
  | 'unknown';

export interface SceneToken {
  type: 'scene';
  time: string;
  interiorExterior: string;
  location: string;
  /** 整行原文（不含 `## ` 前缀后可能的格式差异，保留原始） */
  content: string;
  /** 场次字段解析异常时的提示 */
  parseWarning?: string;
}

export interface ActionToken {
  type: 'action';
  content: string;
}

export interface DialogueToken {
  type: 'dialogue';
  character: string;
  /** 角色提示（语气/动作/画外音等），来自角色行括号 */
  cue?: string;
  content: string;
}

export interface ParentheticalToken {
  type: 'parenthetical';
  content: string;
  /** 归属：dialogue（角色/对白内）或 action（动作块内） */
  owner: 'dialogue' | 'action';
}

export interface TransitionToken {
  type: 'transition';
  content: string;
}

export interface SubtitleToken {
  type: 'subtitle';
  content: string;
}

export interface CommentToken {
  type: 'comment';
  content: string;
}

export interface UnknownToken {
  type: 'unknown';
  content: string;
  reason: string;
}

export type ScriptToken =
  | SceneToken
  | ActionToken
  | DialogueToken
  | ParentheticalToken
  | TransitionToken
  | SubtitleToken
  | CommentToken
  | UnknownToken;

export interface ParsedToken<T extends ScriptToken = ScriptToken> {
  token: T;
  /** 同一剧本版本内稳定；由源范围、类型与内容确定 */
  id: string;
  /** 原始文本（含标记字符，如 `## `、`△`、`**角色名**：`） */
  rawText: string;
  /** 原文字符范围（针对读入时的原始剧本） */
  sourceRange: { start: number; end: number };
  /** 原文行范围（含首末行） */
  lineRange: { start: number; end: number };
}

export interface ParsedScript {
  tokens: ParsedToken[];
  /** 未识别 token 数量 */
  unknownCount: number;
  /** 场次数量 */
  sceneCount: number;
}

/** 生成稳定 ID（同一剧本版本内稳定：按来源范围 + 类型 + 内容哈希） */
function stableId(type: ScriptTokenType, start: number, end: number, content: string): string {
  let hash = 0;
  const seed = `${type}:${start}:${end}:${content}`;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `${type}_${start}_${hash.toString(36)}`;
}

/** 场次标题：`## 场次：时间 / 内外景 / 地点` */
const SCENE_RE = /^##\s*场次[：:]\s*(.*)$/;
/** 动作块起始：行首 `△` */
const ACTION_RE = /^△\s*(.*)$/;
/** 角色提示：`**角色名**：`、`**角色名**（语气）：` 或 `角色名（语气）：` */
const DIALOGUE_HEAD_BOLD_CUE_RE = /^\*\*(.+?)\*\*\s*[（(]([^）)]*)[）)][：:]\s*(.*)$/;
const DIALOGUE_HEAD_RE = /^\*\*(.+?)\*\*[：:]\s*(.*)$/;
const DIALOGUE_HEAD_ALT_RE = /^([^\s*（(]+)\s*[（(]([^）)]*)[）)][：:]\s*(.*)$/;
const DIALOGUE_HEAD_PLAIN_RE = /^([^\s*（(]+)\s*[：:]\s*(.*)$/;
/** 括号提示：全角或半角 */
const PARENTHETICAL_FULL_RE = /^（([^）]*)）\s*$/;
const PARENTHETICAL_HALF_RE = /^\(([^)]*)\)\s*$/;
/** 转场 / 字幕：`【转场：内容】` */
const BRACKET_TRANSITION_RE = /^【\s*转场[：:]\s*(.*?)】\s*$/;
const BRACKET_SUBTITLE_RE = /^【\s*字幕[：:]\s*(.*?)】\s*$/;
const BRACKET_OTHER_RE = /^【\s*(.+?)】\s*$/;
/** HTML 注释 */
const COMMENT_RE = /^<!--([\s\S]*?)-->\s*$/;

function makeToken<T extends ScriptToken>(
  token: T,
  rawText: string,
  sourceRange: { start: number; end: number },
  lineRange: { start: number; end: number },
): ParsedToken<T> {
  return {
    token,
    id: stableId(token.type, sourceRange.start, sourceRange.end, rawText),
    rawText,
    sourceRange,
    lineRange,
  };
}

/**
 * 解析剧本全文为有序 token 列表。
 * 标准化换行仅用于识别行结构，offset 始终针对传入的原始文本。
 */
export function parseScriptSyntax(content: string): ParsedScript {
  const tokens: ParsedToken[] = [];
  if (!content) return { tokens, unknownCount: 0, sceneCount: 0 };

  const { lines, lineStarts } = splitLinesWithOffsets(content);

  let i = 0;
  let unknownCount = 0;
  let sceneCount = 0;
  // 当前是否处于一个 action 块内（用于归属续行与括号）
  let inActionBlock = false;

  while (i < lines.length) {
    const line = lines[i];
    // 计算该行在原文中的偏移（近似：按累计换行长度）
    const lineStart = lineStarts[i];
    const lineEnd = lineStart + line.length;

    const trimmed = line.trim();

    // 空行：结束 action 块
    if (!trimmed) {
      inActionBlock = false;
      i++;
      continue;
    }

    // HTML 注释
    const commentMatch = trimmed.match(COMMENT_RE);
    if (commentMatch) {
      tokens.push(
        makeToken(
          { type: 'comment', content: commentMatch[1].trim() },
          line,
          { start: lineStart, end: lineEnd },
          { start: i + 1, end: i + 1 },
        ),
      );
      i++;
      continue;
    }

    // 场次标题
    const sceneMatch = trimmed.match(SCENE_RE);
    if (sceneMatch) {
      const parsed = parseSceneHeader(sceneMatch[1].trim());
      tokens.push(
        makeToken(
          parsed,
          line,
          { start: lineStart, end: lineEnd },
          { start: i + 1, end: i + 1 },
        ),
      );
      sceneCount++;
      inActionBlock = false;
      i++;
      continue;
    }

    // 转场 / 字幕 / 其他方括号
    const transitionMatch = trimmed.match(BRACKET_TRANSITION_RE);
    if (transitionMatch) {
      tokens.push(
        makeToken(
          { type: 'transition', content: transitionMatch[1].trim() },
          line,
          { start: lineStart, end: lineEnd },
          { start: i + 1, end: i + 1 },
        ),
      );
      i++;
      continue;
    }
    const subtitleMatch = trimmed.match(BRACKET_SUBTITLE_RE);
    if (subtitleMatch) {
      tokens.push(
        makeToken(
          { type: 'subtitle', content: subtitleMatch[1].trim() },
          line,
          { start: lineStart, end: lineEnd },
          { start: i + 1, end: i + 1 },
        ),
      );
      i++;
      continue;
    }
    const bracketOther = trimmed.match(BRACKET_OTHER_RE);
    if (bracketOther) {
      tokens.push(
        makeToken(
          {
            type: 'unknown',
            content: bracketOther[1].trim(),
            reason: '未支持的方括号标记',
          },
          line,
          { start: lineStart, end: lineEnd },
          { start: i + 1, end: i + 1 },
        ),
      );
      unknownCount++;
      i++;
      continue;
    }

    // 动作块起始
    const actionMatch = trimmed.match(ACTION_RE);
    if (actionMatch) {
      inActionBlock = true;
      // 收集动作块（含续行）
      const block = collectActionBlock(lines, i, actionMatch[1]);
      const blockEnd = i + block.lineCount - 1;
      const blockEndOffset = lineStarts[blockEnd] + lines[blockEnd].length;
      tokens.push(
        makeToken(
          { type: 'action', content: block.content },
          block.rawText,
          { start: lineStart, end: blockEndOffset },
          { start: i + 1, end: blockEnd + 1 },
        ),
      );
      i += block.lineCount;
      continue;
    }

    // 角色提示（对白头部）
    const dialogueHead = matchDialogueHead(trimmed);
    if (dialogueHead) {
      inActionBlock = false;
      const result = collectDialogue(lines, i, dialogueHead);
      const endLine = i + result.lineCount - 1;
      const endOffset = lineStarts[endLine] + lines[endLine].length;
      tokens.push(
        makeToken(
          {
            type: 'dialogue',
            character: dialogueHead.character,
            cue: dialogueHead.cue,
            content: result.content,
          },
          result.rawText,
          { start: lineStart, end: endOffset },
          { start: i + 1, end: endLine + 1 },
        ),
      );
      i += result.lineCount;
      continue;
    }

    // 括号提示
    const paren = matchParenthetical(trimmed);
    if (paren) {
      tokens.push(
        makeToken(
          { type: 'parenthetical', content: paren.content, owner: inActionBlock ? 'action' : 'dialogue' },
          line,
          { start: lineStart, end: lineEnd },
          { start: i + 1, end: i + 1 },
        ),
      );
      i++;
      continue;
    }

    // 未识别
    tokens.push(
      makeToken(
        { type: 'unknown', content: trimmed, reason: '未识别格式' },
        line,
        { start: lineStart, end: lineEnd },
        { start: i + 1, end: i + 1 },
      ),
    );
    unknownCount++;
    i++;
  }

  return { tokens, unknownCount, sceneCount };
}

/** 解析 `时间 / 内外景 / 地点`，字段缺失不猜测，写入 parseWarning */
function parseSceneHeader(header: string): SceneToken {
  const parts = header.split('/').map((p) => p.trim());
  if (parts.length === 3) {
    return {
      type: 'scene',
      time: parts[0],
      interiorExterior: parts[1],
      location: parts[2],
      content: header,
    };
  }
  return {
    type: 'scene',
    time: '',
    interiorExterior: '',
    location: header,
    content: header,
    parseWarning: '待确认：场次格式',
  };
}

/** 匹配角色提示行，返回角色名、cue 与行内剩余内容 */
function matchDialogueHead(
  trimmed: string,
): { character: string; cue?: string; inline?: string } | null {
  const boldCue = trimmed.match(DIALOGUE_HEAD_BOLD_CUE_RE);
  if (boldCue) {
    return {
      character: boldCue[1].trim(),
      cue: boldCue[2].trim() || undefined,
      inline: boldCue[3].trim() || undefined,
    };
  }
  const m1 = trimmed.match(DIALOGUE_HEAD_RE);
  if (m1) {
    const character = m1[1].trim();
    const inline = m1[2].trim();
    return { character, cue: undefined, inline: inline || undefined };
  }
  const m2 = trimmed.match(DIALOGUE_HEAD_ALT_RE);
  if (m2) {
    return { character: m2[1].trim(), cue: m2[2].trim(), inline: m2[3].trim() || undefined };
  }
  const m3 = trimmed.match(DIALOGUE_HEAD_PLAIN_RE);
  if (m3) {
    return { character: m3[1].trim(), cue: undefined, inline: m3[2].trim() || undefined };
  }
  return null;
}

function matchParenthetical(trimmed: string): { content: string } | null {
  const m1 = trimmed.match(PARENTHETICAL_FULL_RE);
  if (m1) return { content: m1[1].trim() };
  const m2 = trimmed.match(PARENTHETICAL_HALF_RE);
  if (m2) return { content: m2[1].trim() };
  return null;
}

interface CollectedBlock {
  content: string;
  rawText: string;
  lineCount: number;
}

/** 收集一个 `△` 动作块：后续连续非空普通文本作为续行 */
function collectActionBlock(lines: string[], startIndex: number, firstContent: string): CollectedBlock {
  const parts: string[] = [firstContent];
  const rawParts: string[] = [lines[startIndex]];
  let j = startIndex + 1;
  while (j < lines.length) {
    const t = lines[j].trim();
    if (!t) break;
    // 遇到新的语法标记则结束
    if (
      SCENE_RE.test(t) ||
      ACTION_RE.test(t) ||
      matchDialogueHead(t) ||
      matchParenthetical(t) ||
      BRACKET_TRANSITION_RE.test(t) ||
      BRACKET_SUBTITLE_RE.test(t) ||
      BRACKET_OTHER_RE.test(t) ||
      COMMENT_RE.test(t)
    ) {
      break;
    }
    parts.push(t);
    rawParts.push(lines[j]);
    j++;
  }
  return { content: parts.join(' '), rawText: rawParts.join('\n'), lineCount: j - startIndex };
}

/** 收集对白：角色头行后随非空行，直到空行或下一条明确标记 */
function collectDialogue(
  lines: string[],
  startIndex: number,
  head: { character: string; cue?: string; inline?: string },
): CollectedBlock {
  const rawParts: string[] = [lines[startIndex]];
  const contentParts: string[] = [];
  if (head.inline) contentParts.push(head.inline);

  let j = startIndex + 1;
  while (j < lines.length) {
    const t = lines[j].trim();
    if (!t) break;
    // 遇到明确标记结束（角色行、动作、场次、方括号、注释、括号提示）
    if (
      SCENE_RE.test(t) ||
      ACTION_RE.test(t) ||
      matchDialogueHead(t) ||
      matchParenthetical(t) ||
      BRACKET_TRANSITION_RE.test(t) ||
      BRACKET_SUBTITLE_RE.test(t) ||
      BRACKET_OTHER_RE.test(t) ||
      COMMENT_RE.test(t)
    ) {
      break;
    }
    contentParts.push(t);
    rawParts.push(lines[j]);
    j++;
  }

  return {
    content: contentParts.join('\n'),
    rawText: rawParts.join('\n'),
    lineCount: j - startIndex,
  };
}

/** 拆行并保留每行在原始字符串中的偏移，兼容 LF、CRLF 和 CR。 */
function splitLinesWithOffsets(content: string): { lines: string[]; lineStarts: number[] } {
  const lines: string[] = [];
  const lineStarts: number[] = [];
  const newline = /\r\n|\n|\r/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = newline.exec(content))) {
    lineStarts.push(start);
    lines.push(content.slice(start, match.index));
    start = match.index + match[0].length;
  }
  lineStarts.push(start);
  lines.push(content.slice(start));
  return { lines, lineStarts };
}
