// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ScriptAgentPanel — Right panel of the script workspace.
 * 
 * Provides:
 * - Agent chat interface with context-aware protocol:
 *   • Current file path and name
 *   • Selected text / cursor position
 *   • Directory summary (file tree)
 *   • Script version (lastModified)
 *   • Project asset references (via store)
 * - Diff confirmation UI: agent proposes changes as diffs, user confirms before write
 * - Storyboard suggestions: structured shot parsing with accept/reject
 * - Quick actions: 续写、改写、结构提取、分镜建议、创建蓝图导入预览
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useScriptWorkspaceStore, type AgentMessage, type StoryboardSuggestion } from '@/stores/script-workspace-store';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { useMediaPanelStore } from '@/stores/media-panel-store';
import { parseMarkdownScript, scenesToShots } from '@/lib/blueprint/markdown-script-parser';
import { callFeatureAPI } from '@/lib/ai/feature-router';
import { BlueprintImportPreview } from './BlueprintImportPreview';
import { cn } from '@/lib/utils';
import {
  SendIcon,
  CheckIcon,
  XIcon,
  TrashIcon,
  FilmIcon,
  DiffIcon,
  LoaderIcon,
  MessageSquareIcon,
  LayersIcon,
  FileTextIcon,
  PaperclipIcon,
  PlusIcon,
  HistoryIcon,
} from 'lucide-react';
import { generateUUID } from '@/lib/utils';
import { toast } from 'sonner';
import { getScriptWorkspaceFs } from '@/lib/script-workspace-fs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const SCRIPT_AGENT_SYSTEM_PROMPT = `你是“有点创艺”的专业剧本 Agent，而不只是聊天机器人。你正在协助用户操作当前剧本工作区。
你可以读取 workspace.files 中提供的文件列表和正文，并根据用户要求提出对文件的编辑。
必须只返回一个 JSON 对象，不要使用 Markdown 代码围栏，格式如下：
{"reply":"给用户看的中文说明","edits":[{"filePath":"相对路径.md","proposedContent":"完整的新文件正文"}]}
没有编辑时 edits 必须是空数组。编辑时必须提供完整正文，不能使用省略号；filePath 必须来自 workspace.files 的 path，不能越过工作区。
如果用户只是询问，请只填写 reply。不得编造未提供的文件内容，不得泄露或索要 API Key。`;

const MAX_CONTEXT_FILE_SIZE = 2 * 1024 * 1024;
const CONTEXT_FILE_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'json', 'csv', 'yaml', 'yml']);
const MAX_WORKSPACE_CONTEXT_SIZE = 800_000;

type AgentEdit = { filePath: string; proposedContent: string };
type ParsedAgentResponse = { reply: string; edits: AgentEdit[] };

function parseAgentResponse(raw: string): ParsedAgentResponse {
  const candidate = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(candidate) as Partial<ParsedAgentResponse>;
    return {
      reply: typeof parsed.reply === 'string' ? parsed.reply : raw,
      edits: Array.isArray(parsed.edits) ? parsed.edits.filter((edit): edit is AgentEdit => Boolean(
        edit && typeof edit.filePath === 'string' && typeof edit.proposedContent === 'string',
      )) : [],
    };
  } catch {
    return { reply: raw, edits: [] };
  }
}

/** Diff viewer component for proposed changes.
 *  Shows a unified diff-style view with added/removed lines.
 */
function DiffViewer({
  original,
  proposed,
  onApply,
  onReject,
  applied,
}: {
  original: string;
  proposed: string;
  onApply: () => void;
  onReject: () => void;
  applied: boolean | undefined;
}) {
  const originalLines = original.split('\n');
  const proposedLines = proposed.split('\n');

  // Simple line-level diff: show removed (-) and added (+) lines
  const diffLines: Array<{ type: 'same' | 'added' | 'removed'; content: string; lineNum?: number }> = [];
  const maxLen = Math.max(originalLines.length, proposedLines.length);
  for (let i = 0; i < maxLen; i++) {
    const orig = i < originalLines.length ? originalLines[i] : undefined;
    const prop = i < proposedLines.length ? proposedLines[i] : undefined;
    if (orig === prop) {
      diffLines.push({ type: 'same', content: orig ?? '', lineNum: i + 1 });
    } else {
      if (orig !== undefined) diffLines.push({ type: 'removed', content: orig, lineNum: i + 1 });
      if (prop !== undefined) diffLines.push({ type: 'added', content: prop, lineNum: i + 1 });
    }
  }

  // Limit display for very long diffs
  const displayLines = diffLines.length > 100
    ? diffLines.slice(0, 50).concat([{ type: 'same', content: `... 省略 ${diffLines.length - 100} 行 ...` }], diffLines.slice(-50))
    : diffLines;

  return (
    <div className="mt-2 border border-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-muted/50 border-b border-border">
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <DiffIcon className="h-3 w-3" />
          变更预览
          <span className="ml-1 text-[9px]">
            (+{diffLines.filter(l => l.type === 'added').length}
            /-{diffLines.filter(l => l.type === 'removed').length})
          </span>
        </span>
        {!applied && (
          <div className="flex gap-1">
            <button
              onClick={onReject}
              className="px-2 py-0.5 text-[10px] bg-red-500/10 text-red-500 rounded hover:bg-red-500/20"
            >
              <XIcon className="h-3 w-3 inline mr-0.5" />
              拒绝
            </button>
            <button
              onClick={onApply}
              className="px-2 py-0.5 text-[10px] bg-green-500/10 text-green-500 rounded hover:bg-green-500/20"
            >
              <CheckIcon className="h-3 w-3 inline mr-0.5" />
              应用
            </button>
          </div>
        )}
        {applied === true && (
          <span className="text-[10px] text-green-500">✓ 已应用</span>
        )}
        {applied === false && (
          <span className="text-[10px] text-red-500">✗ 已拒绝</span>
        )}
      </div>
      <div className="max-h-48 overflow-y-auto text-[11px] font-mono">
        {displayLines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "px-2 py-px",
              line.type === 'added' && "bg-green-500/10 text-green-700 dark:text-green-400",
              line.type === 'removed' && "bg-red-500/10 text-red-700 dark:text-red-400 line-through",
              line.type === 'same' && "text-muted-foreground",
            )}
          >
            <span className="inline-block w-6 text-right mr-2 opacity-50 select-none">
              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
            </span>
            {line.content || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Storyboard suggestion card. */
function SuggestionCard({
  suggestion,
  onAccept,
  onReject,
}: {
  suggestion: StoryboardSuggestion;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className={cn(
      "border rounded-md p-2 mt-2",
      suggestion.accepted === true && "border-green-500/30 bg-green-500/5",
      suggestion.accepted === false && "border-red-500/30 bg-red-500/5 opacity-60",
      suggestion.accepted === null && "border-border",
    )}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium flex items-center gap-1">
          <FilmIcon className="h-3 w-3" />
          镜头 {suggestion.shotIndex + 1}: {suggestion.title}
        </span>
        {suggestion.accepted === null && (
          <div className="flex gap-1">
            <button
              onClick={onReject}
              className="p-0.5 hover:bg-red-500/10 rounded"
              title="拒绝"
            >
              <XIcon className="h-3 w-3 text-red-500" />
            </button>
            <button
              onClick={onAccept}
              className="p-0.5 hover:bg-green-500/10 rounded"
              title="接受"
            >
              <CheckIcon className="h-3 w-3 text-green-500" />
            </button>
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">{suggestion.description}</p>
      {suggestion.prompt && (
        <div className="mt-1 p-1.5 bg-muted/50 rounded text-[10px] font-mono">
          {suggestion.prompt}
        </div>
      )}
    </div>
  );
}

export function ScriptAgentPanel() {
  const {
    agentMessages,
    agentSessions,
    agentSessionId,
    isAgentThinking,
    storyboardSuggestions,
    showAgent,
    addAgentMessage,
    clearAgentMessages,
    createAgentSession,
    selectAgentSession,
    deleteAgentSession,
    setAgentThinking,
    addStoryboardSuggestion,
    updateSuggestionStatus,
    rejectDiff,
    editorContent,
    activeFileId,
    files,
    agentContextFiles,
    addAgentContextFile,
    removeAgentContextFile,
    toggleAgentContextFile,
  } = useScriptWorkspaceStore();

  const importFromScript = useBlueprintStore((s) => s.importFromScript);
  const setActiveTab = useMediaPanelStore((s) => s.setActiveTab);

  const [inputText, setInputText] = useState('');
  const [showImportPreview, setShowImportPreview] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDraggingContext, setIsDraggingContext] = useState(false);

  // Parse current editor content into shots for import preview
  const currentShots = useMemo(() => {
    if (!editorContent) return [];
    try {
      const parseResult = parseMarkdownScript(editorContent);
      return scenesToShots(parseResult);
    } catch {
      return [];
    }
  }, [editorContent]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentMessages.length]);

  // Grow the composer with its content, then scroll internally once it reaches
  // the maximum height. Resetting to auto first also allows it to shrink when
  // text is deleted or after a message is sent.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 200 ? 'auto' : 'hidden';
  }, [inputText]);

  /**
   * Build agent context from current workspace state.
   * This context is sent alongside the user's message to provide:
   * - Current file path and name
   * - Selected text / cursor position (if available from textarea)
   * - Directory summary (file list)
   * - Script version (lastModified timestamp)
   *
   * API Key MUST NOT be included in context, logs, or session persistence.
   */
  const buildAgentContext = useCallback(() => {
    const activeFile = files.find(f => f.id === activeFileId);
    const directorySummary = files.map(f => ({
      name: f.name,
      path: f.path,
      type: f.type,
      isDirty: f.isDirty,
      lastModified: f.lastModified,
    }));
    let remaining = MAX_WORKSPACE_CONTEXT_SIZE;
    const workspaceFiles = files.map((file) => {
      if (!file.editable || remaining <= 0) {
        return { path: file.path, name: file.name, type: file.type, content: '[正文未载入]' };
      }
      const content = file.content.slice(0, remaining);
      remaining -= content.length;
      return { path: file.path, name: file.name, type: file.type, content };
    });

    return {
      currentFile: activeFile ? {
        path: activeFile.path,
        name: activeFile.name,
        type: activeFile.type,
        version: activeFile.lastModified,
        lineCount: editorContent.split('\n').length,
        charCount: editorContent.length,
      } : null,
      directorySummary,
      files: workspaceFiles,
      totalFiles: files.length,
      scriptVersion: activeFile?.lastModified || null,
      content: editorContent,
      referenceFiles: agentContextFiles.filter((item) => item.active).map((item) => {
        const workspaceFile = item.source === 'workspace' ? files.find((file) => file.path === item.path) : undefined;
        return { name: item.name, path: item.path, source: item.source, content: workspaceFile?.content ?? item.content ?? '' };
      }),
    };
  }, [files, activeFileId, editorContent, agentContextFiles]);

  const applyAgentEdit = useCallback(async (messageId: string) => {
    const state = useScriptWorkspaceStore.getState();
    const message = state.agentMessages.find((item) => item.id === messageId);
    const edit = message?.diff;
    const workspaceFs = getScriptWorkspaceFs();
    if (!edit || !state.workspaceRoot || !workspaceFs) return toast.error('工作区文件系统不可用');
    const file = state.files.find((item) => item.path === edit.filePath);
    if (!file) return toast.error(`文件不存在：${edit.filePath}`);
    try {
      await workspaceFs.writeFile(state.workspaceRoot, edit.filePath, edit.proposed);
      state.applyDiff(messageId);
      state.markFileSaved(file.id);
      toast.success(`已写入 ${edit.filePath}`);
    } catch (error) {
      toast.error(`写入失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, []);

  const addWorkspaceContext = useCallback((path: string) => {
    const file = files.find((item) => item.path === path);
    if (!file) return toast.error('拖入的工作区文件不存在');
    addAgentContextFile({ id: file.id, name: file.name, path: file.path, source: 'workspace', active: false });
  }, [files, addAgentContextFile]);

  const handleContextDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDraggingContext(false);
    const workspacePath = event.dataTransfer.getData('application/x-moyin-script-file');
    if (workspacePath) { addWorkspaceContext(workspacePath); return; }
    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length === 0) return;
    for (const file of droppedFiles) {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!CONTEXT_FILE_EXTENSIONS.has(extension)) { toast.error(`${file.name} 不是支持的文本文件`); continue; }
      if (file.size > MAX_CONTEXT_FILE_SIZE) { toast.error(`${file.name} 超过 2MB`); continue; }
      try {
        addAgentContextFile({ id: generateUUID(), name: file.name, path: file.name, content: await file.text(), source: 'external', active: false });
      } catch { toast.error(`无法读取 ${file.name}`); }
    }
  }, [addWorkspaceContext, addAgentContextFile]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || isAgentThinking) return;

    const context = buildAgentContext();
    const userMessage: AgentMessage = {
      id: generateUUID(),
      role: 'user',
      content: inputText.trim(),
      timestamp: Date.now(),
    };
    addAgentMessage(userMessage);
    setInputText('');
    setAgentThinking(true);

    try {
      const recentConversation = agentMessages.slice(-8).map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const responseContent = await callFeatureAPI(
        'script_analysis',
        SCRIPT_AGENT_SYSTEM_PROMPT,
        JSON.stringify({
          request: userMessage.content,
          workspace: context,
          recentConversation,
        }),
        { temperature: 0.3, maxTokens: 8192, disableThinking: false },
      );
      const parsed = parseAgentResponse(responseContent);
      const edits = parsed.edits.flatMap((edit) => {
        const originalFile = files.find((file) => file.path === edit.filePath);
        return originalFile && originalFile.content !== edit.proposedContent ? [{ edit, originalFile }] : [];
      });
      if (edits.length === 0) {
        addAgentMessage({ id: generateUUID(), role: 'assistant', content: parsed.reply || '已完成分析。', timestamp: Date.now() });
      } else {
        edits.forEach(({ edit, originalFile }, index) => addAgentMessage({
          id: generateUUID(),
          role: 'assistant',
          content: index === 0 ? parsed.reply || `建议修改 ${edit.filePath}` : `同时建议修改 ${edit.filePath}`,
          timestamp: Date.now(),
          diff: { filePath: edit.filePath, original: originalFile.content, proposed: edit.proposedContent, applied: undefined },
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 调用失败';
      addAgentMessage({
        id: generateUUID(),
        role: 'assistant',
        content: `❌ ${message}`,
        timestamp: Date.now(),
      });
      toast.error(message);
    } finally {
      setAgentThinking(false);
    }
  }, [inputText, isAgentThinking, addAgentMessage, setAgentThinking, buildAgentContext, agentMessages, files]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Handle blueprint import confirmation
  const handleImportConfirm = useCallback(
    ({ target, selectedShotIds, name }: { target: 'new' | string; selectedShotIds?: string[]; name: string }) => {
      try {
        const result = importFromScript(
          {
            shots: currentShots,
            rawScript: editorContent,
            selectedShotIds,
            name,
          },
          target,
        );

        // Add a system message about the import
        const importMessage: AgentMessage = {
          id: generateUUID(),
          role: 'assistant',
          content: `✅ 已导入蓝图「${result.blueprint.name}」\n• ${result.shotCount} 个分镜\n• ${result.nodeCount} 个节点\n• ${result.edgeCount} 条连接\n${result.diagnostics.length > 0 ? `\n⚠️ ${result.diagnostics.length} 条诊断信息` : ''}`,
          timestamp: Date.now(),
        };
        addAgentMessage(importMessage);

        // Navigate to blueprint tab
        setShowImportPreview(false);
        setActiveTab('blueprint');
      } catch (err) {
        const errorMessage: AgentMessage = {
          id: generateUUID(),
          role: 'assistant',
          content: `❌ 导入失败: ${err instanceof Error ? err.message : '未知错误'}`,
          timestamp: Date.now(),
        };
        addAgentMessage(errorMessage);
        setShowImportPreview(false);
      }
    },
    [currentShots, editorContent, importFromScript, addAgentMessage, setActiveTab],
  );

  if (!showAgent) return null;

  return (
    <div className="h-full flex flex-col bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium flex items-center gap-1.5">
          <MessageSquareIcon className="h-3.5 w-3.5" />
          剧本助手
        </span>
        <div className="flex items-center gap-0.5">
          <button onClick={() => { if (!isAgentThinking) { createAgentSession(); setInputText(''); } }} disabled={isAgentThinking} className="p-1 hover:bg-muted rounded transition-colors disabled:opacity-40" title="新建聊天"><PlusIcon className="h-3.5 w-3.5" /></button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="p-1 hover:bg-muted rounded transition-colors" title="历史聊天"><HistoryIcon className="h-3.5 w-3.5" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 max-h-80 overflow-y-auto">
              <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">历史聊天</div>
              <DropdownMenuSeparator />
              {agentSessions.length === 0 ? <div className="px-2 py-4 text-center text-xs text-muted-foreground">暂无聊天记录</div> : agentSessions.map((session) => (
                <DropdownMenuItem key={session.id} onSelect={() => { if (!isAgentThinking) { selectAgentSession(session.id); setInputText(''); } }} className={cn('group flex items-center gap-2', session.id === agentSessionId && 'bg-muted')}>
                  <MessageSquareIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-xs">{session.title}</span><span className="block text-[9px] text-muted-foreground">{new Date(session.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {session.messages.length} 条消息</span></span>
                  <button onClick={(event) => { event.preventDefault(); event.stopPropagation(); deleteAgentSession(session.id); }} className="rounded p-1 opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100" title="删除聊天"><TrashIcon className="h-3 w-3" /></button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button onClick={clearAgentMessages} className="p-1 hover:bg-muted rounded transition-colors" title="清空当前聊天"><TrashIcon className="h-3 w-3" /></button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {agentMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquareIcon className="h-10 w-10 mb-2 opacity-30" />
            <p className="text-xs">开始与 AI 助手对话</p>
            <p className="text-[10px] mt-1">询问剧本建议、分镜优化等</p>
          </div>
        )}

        {agentMessages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex flex-col",
              msg.role === 'user' ? "items-end" : "items-start"
            )}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-xs",
                msg.role === 'user'
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.diff && (
                <DiffViewer
                  original={msg.diff.original}
                  proposed={msg.diff.proposed}
                  onApply={() => void applyAgentEdit(msg.id)}
                  onReject={() => rejectDiff(msg.id)}
                  applied={msg.diff.applied}
                />
              )}
            </div>
            <span className="text-[9px] text-muted-foreground mt-0.5">
              {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}

        {isAgentThinking && (
          <div className="flex items-start">
            <div className="bg-muted rounded-lg px-3 py-2 text-xs flex items-center gap-2">
              <LoaderIcon className="h-3 w-3 animate-spin" />
              思考中...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Storyboard suggestions */}
      {storyboardSuggestions.length > 0 && (
        <div className="px-3 pb-2">
          <div className="text-[10px] text-muted-foreground mb-1">分镜建议</div>
          {storyboardSuggestions.map((sug) => (
            <SuggestionCard
              key={sug.id}
              suggestion={sug}
              onAccept={() => updateSuggestionStatus(sug.id, true)}
              onReject={() => updateSuggestionStatus(sug.id, false)}
            />
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="px-2 pb-1 flex flex-wrap gap-1">
        {[
          { label: '续写', tip: '基于光标位置继续创作' },
          { label: '改写', tip: '优化选中的段落' },
          { label: '提取结构', tip: '解析场景/角色/镜头信息' },
          { label: '分镜建议', tip: '生成分镜头列表' },
        ].map((action) => (
          <button
            key={action.label}
            onClick={() => {
              setInputText(action.label);
              textareaRef.current?.focus();
            }}
            className="px-2 py-0.5 text-[10px] rounded-full border border-border hover:bg-muted/50 hover:border-primary/30 transition-colors"
            title={action.tip}
          >
            {action.label}
          </button>
        ))}
        {/* Blueprint import button — triggers import preview */}
        <button
          onClick={() => setShowImportPreview(true)}
          disabled={currentShots.length === 0}
          className={cn(
            'px-2 py-0.5 text-[10px] rounded-full border transition-colors flex items-center gap-1',
            currentShots.length > 0
              ? 'border-primary/30 bg-primary/5 text-primary hover:bg-primary/10'
              : 'border-border text-muted-foreground cursor-not-allowed',
          )}
          title={currentShots.length > 0 ? '基于当前内容创建蓝图导入预览' : '请先编写包含场景的剧本'}
        >
          <LayersIcon className="h-3 w-3" />
          创建蓝图
        </button>
      </div>

      {/* Blueprint import preview modal */}
      <BlueprintImportPreview
        open={showImportPreview}
        shots={currentShots}
        rawScript={editorContent}
        onImport={handleImportConfirm}
        onCancel={() => setShowImportPreview(false)}
      />

      {/* Input and file context */}
      <div
        className={cn('border-t border-border p-2 transition-colors', isDraggingContext && 'bg-primary/10 ring-1 ring-inset ring-primary')}
        onDragEnter={(event) => { event.preventDefault(); setIsDraggingContext(true); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingContext(false); }}
        onDrop={(event) => void handleContextDrop(event)}
      >
        {agentContextFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Agent 文件上下文">
            {agentContextFiles.map((file) => (
              <div key={file.id} className={cn('flex max-w-full items-center rounded-md border text-[10px] transition-colors', file.active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/40 text-muted-foreground')}>
                <button onClick={() => toggleAgentContextFile(file.id)} className="flex min-w-0 items-center gap-1 px-1.5 py-1" title={file.active ? '点击停用此上下文' : '点击激活此上下文'}>
                  <FileTextIcon className="h-3 w-3 shrink-0" /><span className="max-w-32 truncate">{file.name}</span>
                  {file.active && <CheckIcon className="h-3 w-3 shrink-0" />}
                </button>
                <button onClick={() => removeAgentContextFile(file.id)} className="mr-0.5 rounded p-0.5 hover:bg-destructive/15 hover:text-destructive" title="移除上下文"><XIcon className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
        {isDraggingContext && <div className="mb-2 flex items-center justify-center gap-1 rounded border border-dashed border-primary py-2 text-[10px] text-primary"><PaperclipIcon className="h-3.5 w-3.5" />释放以添加为上下文参考</div>}
        <div className="flex gap-1.5">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            className="flex-1 resize-none overflow-y-hidden bg-muted/50 rounded-md px-2.5 py-1.5 text-xs leading-5 focus:outline-none focus:ring-1 focus:ring-primary min-h-[40px] max-h-[200px]"
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isAgentThinking}
            className={cn(
              "self-end p-1.5 rounded-md transition-colors",
              inputText.trim() && !isAgentThinking
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <SendIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
