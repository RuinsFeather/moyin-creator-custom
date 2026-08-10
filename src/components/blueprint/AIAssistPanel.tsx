// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Blueprint AI Assist Panel (§11.4)
//
// A chat-style popover panel for AI-assisted text writing.
// Features:
//   - Multi-turn conversation with context
//   - Accept/reject proposed text changes
//   - Applied changes go through store.updateNode() → undo/redo stack
//   - Does NOT block execution engine (async only)

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import {
  requestAIAssist,
  type AIAssistMessage,
  type AIAssistResult,
} from '@/lib/blueprint/ai-assist';
import { generateUUID } from '@/lib/utils';

// ── Props ────────────────────────────────────────────────────────────────

interface AIAssistPanelProps {
  /** Current text in the node */
  currentText: string;
  /** Text role (prompt/negative/dialogue/context) */
  role?: string;
  /** Language (zh/en/ja/auto) */
  language?: string;
  /** Called when user accepts an AI-proposed text replacement */
  onApplyText: (newText: string) => void;
  /** Called when user closes the panel */
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────────────────

export const AIAssistPanel = memo(function AIAssistPanel({
  currentText,
  role,
  language,
  onApplyText,
  onClose,
}: AIAssistPanelProps) {
  const [messages, setMessages] = useState<AIAssistMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: AIAssistMessage = {
      id: generateUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const result = await requestAIAssist({
        currentText,
        userInstruction: text,
        role,
        language,
        history: messages,
      });

      const assistantMsg: AIAssistMessage = {
        id: generateUUID(),
        role: 'assistant',
        content: result.response,
        timestamp: Date.now(),
        proposedText: result.proposedText,
        applied: false,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 请求失败');
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, currentText, role, language, messages]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleAccept = useCallback(
    (msgId: string, proposedText: string) => {
      onApplyText(proposedText);
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, applied: true } : m)),
      );
    },
    [onApplyText],
  );

  const handleReject = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, applied: false } : m)),
    );
  }, []);

  const handleClear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-panel shadow-xl">
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="flex items-center gap-1 text-xs font-medium text-foreground">
          <span>✨</span>
          <span>AI 写作助手</span>
        </span>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted"
              title="清空对话"
            >
              🗑
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted"
            title="关闭"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2" style={{ minHeight: 0 }}>
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="text-2xl mb-2">✨</span>
            <p className="text-xs text-muted-foreground">
              告诉我你想如何修改文本
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5 justify-center">
              {[
                '写得更详细',
                '翻译成英文',
                '优化提示词',
                '更简洁',
              ].map((hint) => (
                <button
                  key={hint}
                  onClick={() => setInput(hint)}
                  className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>

              {/* Proposed text preview + accept/reject */}
              {msg.proposedText && msg.role === 'assistant' && (
                <div className="mt-1.5 rounded border border-border bg-background/50 p-1.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[9px] text-muted-foreground">
                      📝 修改建议
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {msg.proposedText.length} 字
                    </span>
                  </div>
                  <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-foreground/80">
                    {msg.proposedText}
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    {msg.applied ? (
                      <span className="text-[10px] text-success">✓ 已应用</span>
                    ) : (
                      <>
                        <button
                          onClick={() => handleAccept(msg.id, msg.proposedText!)}
                          className="rounded bg-success/10 px-2 py-0.5 text-[10px] text-success transition-colors hover:bg-success/20"
                        >
                          ✓ 应用
                        </button>
                        <button
                          onClick={() => handleReject(msg.id)}
                          className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/80"
                        >
                          ✕ 忽略
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="animate-pulse">●</span>
                思考中…
              </span>
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            ⚠ {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border p-2">
        <div className="flex gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入修改指令… (Enter 发送)"
            rows={2}
            className="flex-1 resize-none rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            disabled={isLoading}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || isLoading}
            className="self-end rounded bg-primary px-2.5 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
});
