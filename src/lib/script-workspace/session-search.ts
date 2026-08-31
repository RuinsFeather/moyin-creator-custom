// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL_LICENSE.md.

/**
 * P2 会话搜索
 *
 * 历史聊天下拉顶部的关键词过滤：
 * 匹配会话标题或任意消息内容（大小写不敏感），
 * 命中消息内容的会话返回首个命中片段（供 UI 预览）。
 */

import type { AgentChatSession } from '@/stores/script-workspace-store';

export interface SessionSearchResult {
  session: AgentChatSession;
  /** 标题或消息内容命中的预览片段（无命中时为空串） */
  snippet: string;
}

/** 命中片段前后各保留的字符数 */
const SNIPPET_RADIUS = 24;

/**
 * 过滤会话列表。query 去空白后为空 → 原样返回全部（snippet 为空）。
 */
export function searchAgentSessions(
  sessions: AgentChatSession[],
  query: string,
): SessionSearchResult[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return sessions.map((session) => ({ session, snippet: '' }));
  }

  const results: SessionSearchResult[] = [];
  for (const session of sessions) {
    // 标题命中：直接收录，片段取标题本身
    if (session.title.toLowerCase().includes(keyword)) {
      results.push({ session, snippet: session.title });
      continue;
    }
    // 消息内容命中：取首个命中片段
    for (const message of session.messages) {
      const lower = message.content.toLowerCase();
      const index = lower.indexOf(keyword);
      if (index !== -1) {
        const start = Math.max(0, index - SNIPPET_RADIUS);
        const end = Math.min(message.content.length, index + keyword.length + SNIPPET_RADIUS);
        const prefix = start > 0 ? '…' : '';
        const suffix = end < message.content.length ? '…' : '';
        results.push({
          session,
          snippet: `${prefix}${message.content.slice(start, end)}${suffix}`,
        });
        break;
      }
    }
  }
  return results;
}
