// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Blueprint AI Assist Service (§11.4)
//
// Provides prompt enhancement and writing assistance via LLM chat API.
// Design boundaries:
//   - INPUT:  current text content + user natural language request
//   - OUTPUT: modified text content (string)
//   - UNDO:   changes applied via store.updateNode() → undo/redo stack captures automatically
//   - PERFORMANCE: async calls only, never blocks execution engine

import { callChatAPI } from '@/lib/script/script-parser';
import { getFeatureConfig } from '@/lib/ai/feature-router';

// ── Types ────────────────────────────────────────────────────────────────

export interface AIAssistMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** If the assistant proposed a text replacement, store it here for accept/reject */
  proposedText?: string;
  applied?: boolean;
}

export interface AIAssistRequest {
  /** Current text content in the node */
  currentText: string;
  /** User's natural language instruction */
  userInstruction: string;
  /** Text role: prompt / negative / dialogue / context */
  role?: string;
  /** Language: zh / en / ja / auto */
  language?: string;
  /** Conversation history for multi-turn */
  history?: AIAssistMessage[];
}

export interface AIAssistResult {
  /** The AI's response message */
  response: string;
  /** If the AI proposed a text replacement */
  proposedText?: string;
}

// ── System prompt ─────────────────────────────────────────────────────────

function buildSystemPrompt(role: string, language: string): string {
  const roleDesc: Record<string, string> = {
    prompt: '图片/视频生成的正向提示词（prompt）',
    negative: '负向提示词（negative prompt），用于排除不想要的内容',
    dialogue: '影视剧本中的台词/对白',
    context: '上下文描述信息，用于辅助生成',
  };

  const langDesc: Record<string, string> = {
    zh: '中文',
    en: 'English',
    ja: '日本語',
    auto: '与用户输入相同的语言',
  };

  return `你是一个专业的 AI 写作助手，专门协助用户编写${roleDesc[role] ?? '提示词'}。

你的职责：
1. 根据用户的指令修改、优化或扩写当前文本
2. 保持用户原有的核心意图和风格
3. 输出修改后的完整文本（不是 diff，而是完整替换文本）

输出格式要求：
- 如果用户的请求需要修改文本，用 [TEXT_START] 和 [TEXT_END] 标记包裹修改后的完整文本
- 在标记之前可以简短说明你的修改思路（1-2 句话）
- 如果用户的请求是提问而非修改，在标记之外直接回答
- 使用${langDesc[language] ?? '与用户相同的语言'}回复

示例：
用户：帮我把这段提示词写得更详细
你的回复：
我增加了更多细节描述和风格修饰词。
[TEXT_START]
一个美丽的女孩站在樱花树下，粉色花瓣纷飞，柔和的午后阳光透过树叶洒落，画面采用日系动漫风格，高细节，4K 画质
[TEXT_END]`;
}

// ── Parse AI response ────────────────────────────────────────────────────

/**
 * Extract proposed text from AI response between [TEXT_START] and [TEXT_END] markers.
 * Returns { response, proposedText } where response is the full message
 * and proposedText is the extracted text (if any).
 */
export function parseAIResponse(raw: string): AIAssistResult {
  const startMarker = '[TEXT_START]';
  const endMarker = '[TEXT_END]';

  const startIdx = raw.indexOf(startMarker);
  const endIdx = raw.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const proposedText = raw.slice(startIdx + startMarker.length, endIdx).trim();
    // Response is everything outside the markers
    const before = raw.slice(0, startIdx).trim();
    const after = raw.slice(endIdx + endMarker.length).trim();
    const response = [before, after].filter(Boolean).join('\n') || '已为您修改文本';
    return { response, proposedText };
  }

  // No markers found — pure conversational response
  return { response: raw.trim() };
}

// ── Main assist function ─────────────────────────────────────────────────

/**
 * Call the AI to assist with text writing.
 *
 * §11.4 boundary:
 * - This function is purely async and never blocks the execution engine.
 * - Changes are returned as proposedText; the caller applies them via updateNode().
 * - Undo/redo is handled automatically by the store's existing snapshot mechanism.
 */
export async function requestAIAssist(req: AIAssistRequest): Promise<AIAssistResult> {
  const config = getFeatureConfig('chat');
  if (!config) {
    throw new Error('请先在设置中配置 AI 对话服务（chat 功能绑定）');
  }

  const role = req.role ?? 'prompt';
  const language = req.language ?? 'auto';

  const systemPrompt = buildSystemPrompt(role, language);

  // Build user message with context
  let userMessage = '';
  if (req.currentText) {
    userMessage += `当前文本：\n\`\`\`\n${req.currentText}\n\`\`\`\n\n`;
  }
  userMessage += `用户指令：${req.userInstruction}`;

  const raw = await callChatAPI(systemPrompt, userMessage, {
    apiKey: config.apiKey,
    provider: String(config.provider),
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: 0.7,
    maxTokens: 4096,
    keyManager: config.keyManager,
  });

  return parseAIResponse(raw);
}
