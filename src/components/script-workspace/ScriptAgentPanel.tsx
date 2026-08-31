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
import { useScriptWorkspaceStore, type AgentMessage, type ScriptFileEntry } from '@/stores/script-workspace-store';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { useMediaPanelStore } from '@/stores/media-panel-store';
import { useAPIConfigStore } from '@/stores/api-config-store';
import { parseMarkdownScript, scenesToShots } from '@/lib/blueprint/markdown-script-parser';
import { callFeatureAPIStream, getAllFeatureConfigs } from '@/lib/ai/feature-router';
import { SCRIPT_AGENT_SYSTEM_PROMPT, parseAgentResponse, renderStreamingText, type AgentEdit } from '@/lib/script-workspace/agent-protocol';
import {
  applyContextBudget,
  computeCharBudget,
  getContextWindowForModel,
} from '@/lib/script-workspace/agent-context-budget';
import { getFeatureConfig } from '@/lib/ai/feature-router';
import {
  describeImage,
  estimateDataUrlBytes,
  isImageDataUrl,
  MAX_IMAGE_CONTEXT_BYTES,
  MAX_IMAGE_CONTEXT_COUNT,
} from '@/lib/script-workspace/image-context';
import { searchAgentSessions } from '@/lib/script-workspace/session-search';
import { validateCreatePath } from '@/lib/script-workspace/safe-path';
import { BlueprintImportPreview } from './BlueprintImportPreview';
import { cn } from '@/lib/utils';
import {
  SendIcon,
  CheckIcon,
  XIcon,
  TrashIcon,
  DiffIcon,
  LoaderIcon,
  MessageSquareIcon,
  LayersIcon,
  FileTextIcon,
  FolderIcon,
  PaperclipIcon,
  PlusIcon,
  HistoryIcon,
  SquareIcon,
  ArrowDownIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  BrainIcon,
  CopyIcon,
  RefreshCwIcon,
  CpuIcon,
  ImageIcon,
  Undo2Icon,
  SearchIcon,
} from 'lucide-react';
import { generateUUID } from '@/lib/utils';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getScriptWorkspaceFs } from '@/lib/script-workspace-fs';
import { computeLineDiff, collapseDiffLines } from '@/lib/script-workspace/lcs-diff';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const MAX_CONTEXT_FILE_SIZE = 2 * 1024 * 1024;
const CONTEXT_FILE_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'json', 'csv', 'yaml', 'yml']);
/** 目录上下文最多收集的文件数（避免超大目录打爆上下文） */
const MAX_DIRECTORY_CONTEXT_FILES = 50;
/** P2 图片拖入：临时保存的 dataURL 上限（超过直接拒收，不走图片理解） */
const MAX_DROPPED_IMAGE_BYTES = 8 * 1024 * 1024;

type ParsedAgentResponse = { reply: string; edits: AgentEdit[] };

/** Diff viewer component for proposed changes.
 *  Shows a unified diff-style view with added/removed lines.
 *//**
 * 2.2 助手消息 Markdown 渲染。
 * react-markdown 默认转义内联 HTML（不引入 rehype-raw）—— 协议要求的 XSS 防护。
 * 代码块带等宽字体与一键复制；表格/列表/引用走 GFM。
 */
function MarkdownContent({ text }: { text: string }) {
  const handleCopy = (code: string) => {
    navigator.clipboard?.writeText(code).then(
      () => toast.success('已复制代码'),
      () => toast.error('复制失败'),
    );
  };
  return (
    <div className="space-y-1.5 leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ className, children, ...props }) => {
            const raw = String(children ?? '');
            const isBlock = /language-/.test(className ?? '') || raw.includes('\n');
            if (!isBlock) {
              return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-primary" {...props}>{children}</code>;
            }
            const lang = /language-(\w+)/.exec(className ?? '')?.[1] ?? '';
            return (
              <div className="group relative my-1 rounded-md border border-border bg-muted/60">
                <div className="flex items-center justify-between border-b border-border px-2 py-0.5">
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{lang || 'code'}</span>
                  <button
                    onClick={() => handleCopy(raw.replace(/\n$/, ''))}
                    className="text-[9px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    title="复制代码"
                  >
                    复制
                  </button>
                </div>
                <pre className="overflow-x-auto p-2 font-mono text-[11px] leading-4">{children}</pre>
              </div>
            );
          },
          a: ({ children, ...props }) => (
            <a className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer" {...props}>{children}</a>
          ),
          table: ({ children }) => (
            <div className="my-1 overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-border bg-muted/50 px-1.5 py-0.5 text-left">{children}</th>,
          td: ({ children }) => <td className="border border-border px-1.5 py-0.5">{children}</td>,
          ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-2 text-muted-foreground">{children}</blockquote>,
          h1: ({ children }) => <h3 className="text-xs font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="text-xs font-semibold">{children}</h3>,
          h3: ({ children }) => <h4 className="text-xs font-medium">{children}</h4>,
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
/**
 * ⑥ 思考过程（reasoning_content）折叠区。
 * 默认收起；流式期间收起态显示"思考中"动画，展开态逐字追加。
 */
function ReasoningBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="mb-1.5 rounded border border-border/60 bg-background/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
        <BrainIcon className="h-3 w-3" />
        <span>{streaming && !open ? '思考中…' : '思考过程'}</span>
        <span className="ml-auto tabular-nums">{text.length} 字</span>
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto border-t border-border/60 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}

function DiffViewer({
  original,
  proposed,
  onApply,
  onReject,
  applied,
  kind,
  reverted,
  onRevert,
}: {
  original: string;
  proposed: string;
  onApply: () => void;
  onReject: () => void;
  applied: boolean | undefined;
  /** P2：'create' = 新建文件（头部显示“新建文件”而非变更预览） */
  kind?: 'edit' | 'create';
  /** P2 checkpoint：已撤销 */
  reverted?: boolean;
  onRevert?: () => void;
}) {
  // ⑧ LCS 行级 diff：头部插入一行只产生 1 条 added，不再全红全绿
  const diffLines = useMemo(() => computeLineDiff(original, proposed), [original, proposed]);
  const addedCount = useMemo(() => diffLines.filter((l) => l.type === 'added').length, [diffLines]);
  const removedCount = useMemo(() => diffLines.filter((l) => l.type === 'removed').length, [diffLines]);

  // Limit display for very long diffs（折叠头尾各 50 行）
  const { lines: displayLines, collapsed } = useMemo(
    () => collapseDiffLines(diffLines, 100),
    [diffLines],
  );

  return (
    <div className="mt-2 border border-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-muted/50 border-b border-border">
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <DiffIcon className="h-3 w-3" />
          {kind === 'create' ? '新建文件' : '变更预览'}
          <span className="ml-1 text-[9px]">
            (+{addedCount}/-{removedCount})
          </span>
        </span>
        <div className="flex gap-1">
          {!applied && (
            <>
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
            </>
          )}
          {applied === true && !reverted && (
            <>
              <span className="text-[10px] text-green-500">✓ 已应用</span>
              {onRevert && (
                <button
                  onClick={onRevert}
                  className="px-1.5 py-0.5 text-[10px] text-muted-foreground rounded hover:bg-muted hover:text-foreground transition-colors"
                  title="撤销本次写入（回滚到应用前内容）"
                >
                  <Undo2Icon className="h-3 w-3 inline mr-0.5" />
                  撤销
                </button>
              )}
            </>
          )}
          {applied === true && reverted && (
            <span className="text-[10px] text-muted-foreground">↩ 已撤销</span>
          )}
          {applied === false && (
            <span className="text-[10px] text-red-500">✗ 已拒绝</span>
          )}
        </div>
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

export function ScriptAgentPanel() {
  const {
    agentMessages,
    agentSessions,
    agentSessionId,
    isAgentThinking,
    showAgent,
    addAgentMessage,
    clearAgentMessages,
    createAgentSession,
    selectAgentSession,
    deleteAgentSession,
    setAgentThinking,
    agentModelOverride,
    setAgentModelOverride,
    rejectDiff,
    truncateAgentMessages,
    revertDiff,
    editorContent,
    activeFileId,
    files,
    agentContextFiles,
    addAgentContextFile,
    removeAgentContextFile,
    toggleAgentContextFile,
  } = useScriptWorkspaceStore();

  // ⑦ 编辑器选区（响应式：驱动续写/改写按钮的可用态）
  const selection = useScriptWorkspaceStore((s) => s.editorSelection);

  const importFromScript = useBlueprintStore((s) => s.importFromScript);
  const setActiveTab = useMediaPanelStore((s) => s.setActiveTab);

  // ⑩ 订阅 API 配置变化（providers/featureBindings），驱动模型下拉刷新
  const apiProviders = useAPIConfigStore((s) => s.providers);
  const apiFeatureBindings = useAPIConfigStore((s) => s.featureBindings);
  const apiConfigVersion = useMemo(() => JSON.stringify({ apiProviders, apiFeatureBindings }), [apiProviders, apiFeatureBindings]);

  const [inputText, setInputText] = useState('');
  const [showImportPreview, setShowImportPreview] = useState(false);
  /** P2 会话搜索关键词（历史聊天下拉内过滤） */
  const [sessionSearch, setSessionSearch] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDraggingContext, setIsDraggingContext] = useState(false);
  /** 当前生成中的 AbortController；null 表示空闲。供"停止生成"按钮与 Escape 中止使用 */
  const abortRef = useRef<AbortController | null>(null);
  /** 2.3 智能滚动：消息容器元素 */
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** 用户是否"贴底"（距底 < 40px）。仅贴底时流式增量才自动滚动 */
  const isAtBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  /** 2.3 判断滚动位置并更新贴底状态 */
  const handleMessagesScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < 40;
    if (atBottom !== isAtBottomRef.current) {
      isAtBottomRef.current = atBottom;
      if (atBottom) setShowJumpToLatest(false);
      else if (!atBottom) setShowJumpToLatest(true);
    }
  }, []);

  /** 2.3 强制回到底部（发送消息 / 点击"回到最新"时调用，无视贴底状态） */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isAtBottomRef.current = true;
    setShowJumpToLatest(false);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

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

  // 2.3 智能自动滚动：仅当用户贴底时才跟随流式增量；
  // 用户上滚阅读历史后不再强制拉回（VS Code 行为），由"回到最新"按钮接管
  useEffect(() => {
    if (!isAtBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [agentMessages.length, isAgentThinking, agentMessages[agentMessages.length - 1]?.content]);

  // 新消息发出（数量变化来自自己）时强制回底：直接以发送者身份重置贴底状态
  // —— 通过比较最近两条消息时间戳区分"自己发送"与"流式更新"不可靠，
  //    改在 handleSend 内显式调用 scrollToBottom()（见下）
  useEffect(() => {
    if (agentMessages.length === 0) {
      isAtBottomRef.current = true;
      setShowJumpToLatest(false);
    }
  }, [agentMessages.length]);

  // 切换会话后重置滚动状态
  useEffect(() => {
    isAtBottomRef.current = true;
    setShowJumpToLatest(false);
    requestAnimationFrame(() => scrollToBottom('auto'));
  }, [agentSessionId, scrollToBottom]);

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

    // —— 2.4 上下文预算：按 script_analysis 绑定模型的 contextWindow 反算字符预算 ——
    // 分层：编辑器全文 + 勾选参考优先，其余文件预算不足时降级为摘要
    // ⑩ 模型切换时按所选模型的上下文窗口计算预算
    const boundModel = useScriptWorkspaceStore.getState().agentModelOverride
      ?? getFeatureConfig('script_analysis')?.model;
    const charBudget = computeCharBudget(getContextWindowForModel(boundModel));

    // 优先全文集合：当前编辑器文件 + 所有勾选激活的参考（含目录成员）
    const priorityPaths = new Set<string>();
    if (activeFile) priorityPaths.add(activeFile.path);
    for (const item of agentContextFiles) {
      if (!item.active) continue;
      if (item.isDirectory && item.source === 'workspace') {
        const prefix = `${item.path}/`;
        files.filter((file) => file.path.startsWith(prefix)).forEach((file) => priorityPaths.add(file.path));
      } else if (item.source === 'workspace') {
        priorityPaths.add(item.path);
      }
    }

    const budgetResult = applyContextBudget(
      files.map((file) => ({ path: file.path, name: file.name, type: file.type, content: file.content, editable: file.editable })),
      priorityPaths,
      charBudget,
    );
    if (budgetResult.degradedCount > 0) {
      toast.info(`上下文已裁剪：${budgetResult.degradedCount} 个文件仅发送摘要（模型上下文预算 ${charBudget} 字符）`, { duration: 4000 });
    }
    const workspaceFiles = budgetResult.files.map(({ path, name, type, content }) => ({ path, name, type, content }));

    // ⑦ 选区/光标：无选区时光标位置仍上报（续写场景），选中文本时附前后文偏移
    const sel = useScriptWorkspaceStore.getState().editorSelection;
    const selectionContext = sel ? {
      hasSelection: sel.text.length > 0,
      text: sel.text.length > 0 ? sel.text : undefined,
      line: sel.line + 1,
      column: sel.column + 1,
      startOffset: sel.startOffset,
      endOffset: sel.endOffset,
    } : null;

    return {
      currentFile: activeFile ? {
        path: activeFile.path,
        name: activeFile.name,
        type: activeFile.type,
        version: activeFile.lastModified,
        lineCount: editorContent.split('\n').length,
        charCount: editorContent.length,
      } : null,
      // ⑦ 选区/光标上下文：选中文本 + 光标行列（续写用光标，改写用选区）
      selection: selectionContext,
      directorySummary,
      files: workspaceFiles,
      totalFiles: files.length,
      contextBudget: { charBudget, fullFiles: budgetResult.fullCount, degradedFiles: budgetResult.degradedCount },
      scriptVersion: activeFile?.lastModified || null,
      content: editorContent,
      referenceFiles: agentContextFiles.filter((item) => item.active && !item.isImage).flatMap((item) => {
        // 目录上下文：收集该目录下所有文本文件正文
        if (item.isDirectory) {
          if (item.source !== 'workspace') return [];
          const prefix = `${item.path}/`;
          return files
            .filter((file) => file.path.startsWith(prefix) && file.editable)
            .slice(0, MAX_DIRECTORY_CONTEXT_FILES)
            .map((file) => ({ name: file.name, path: file.path, source: 'workspace', content: file.content }));
        }
        const workspaceFile = item.source === 'workspace' ? files.find((file) => file.path === item.path) : undefined;
        return [{ name: item.name, path: item.path, source: item.source, content: workspaceFile?.content ?? item.content ?? '' }];
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
    // P2 CREATE：路径校验（安全相对路径 + 后缀白名单）
    if (edit.kind === 'create') {
      if (validateCreatePath(edit.filePath)) return toast.error(`新建路径不合法：${validateCreatePath(edit.filePath)}`);
      if (file) return toast.error(`文件已存在：${edit.filePath}（拒绝覆盖，请让 Agent 改用修改）`);
    } else if (!file) {
      return toast.error(`文件不存在：${edit.filePath}`);
    }
    try {
      // P2 checkpoint：应用前读磁盘快照（磁盘上可能比 store 中更新；create 无快照）
      let snapshot: string | null = null;
      if (edit.kind !== 'create') {
        try {
          snapshot = await workspaceFs.readFile(state.workspaceRoot, edit.filePath);
        } catch {
          // 磁盘读失败退回 store 内容（上方已校验 edit 分支时 file 必存在）
          snapshot = file!.content;
        }
      }
      await workspaceFs.writeFile(state.workspaceRoot, edit.filePath, edit.proposed);
      // 快照写入消息（供撤销）；随后 applyDiff 更新 files/编辑器
      useScriptWorkspaceStore.setState((s) => ({
        agentMessages: s.agentMessages.map((m) =>
          m.id === messageId && m.diff ? { ...m, diff: { ...m.diff, snapshot } } : m
        ),
      }));
      // Bug1 修复：磁盘已落盘，applyDiff 一次原子完成“应用+标记已保存”
      // （原 writeFile→applyDiff→markFileSaved 三步耦合，任一步失败留下中间态；
      //   且 create 分支 file 恒为空，markFileSaved 被跳过导致新建文件永远显示未保存）
      state.applyDiff(messageId, { saved: true });
      toast.success(edit.kind === 'create' ? `已新建 ${edit.filePath}` : `已写入 ${edit.filePath}`);
    } catch (error) {
      toast.error(`写入失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, []);

  const addWorkspaceContext = useCallback((path: string) => {
    const file = files.find((item) => item.path === path);
    if (!file) return toast.error('拖入的工作区文件不存在');
    addAgentContextFile({ id: file.id, name: file.name, path: file.path, source: 'workspace', active: false, addedBy: 'manual' });
  }, [files, addAgentContextFile]);

  // ── ⑩ 会话内模型切换 ────────────────────────────────────────────────
  // script_analysis 功能绑定的全部可用模型（platform:model 展示为纯模型名）
  const availableModels = useMemo(() => {
    const configs = getAllFeatureConfigs('script_analysis');
    const models = configs.map((config) => config.model).filter((model): model is string => Boolean(model));
    // 去重（多供应商可能绑同一模型）
    return Array.from(new Set(models));
  }, [apiConfigVersion]);

  // ── ⑧ 批量应用 ──────────────────────────────────────────────────────
  const pendingDiffCount = useMemo(
    () => agentMessages.filter((m) => m.diff && m.diff.applied === undefined).length,
    [agentMessages],
  );

  const handleApplyAllPending = useCallback(async () => {
    const pending = useScriptWorkspaceStore.getState().agentMessages
      .filter((m) => m.diff && m.diff.applied === undefined)
      .map((m) => m.id);
    if (pending.length === 0) return;
    let appliedCount = 0;
    let failedCount = 0;
    for (const id of pending) {
      // applyAgentEdit 内部自行 toast；这里只统计结果（静默模式可后续优化）
      const before = useScriptWorkspaceStore.getState().agentMessages.find((m) => m.id === id)?.diff?.applied;
      await applyAgentEdit(id);
      const after = useScriptWorkspaceStore.getState().agentMessages.find((m) => m.id === id)?.diff?.applied;
      if (after === true && before !== true) appliedCount++;
      else failedCount++;
    }
    if (appliedCount > 0 && failedCount === 0) toast.success(`已全部应用：${appliedCount} 处修改`);
    else if (failedCount > 0) toast.error(`${appliedCount} 处成功，${failedCount} 处失败（详见上方提示）`);
  }, [applyAgentEdit]);

  /** P2 图片拖入 → 暂存为 dataURL 上下文（发送时转写为文字描述） */
  const addImageContext = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return false;
    const imageCount = useScriptWorkspaceStore.getState().agentContextFiles.filter((item) => item.isImage).length;
    if (imageCount >= MAX_IMAGE_CONTEXT_COUNT) {
      toast.error(`图片参考最多 ${MAX_IMAGE_CONTEXT_COUNT} 张`);
      return true;
    }
    if (file.size > MAX_DROPPED_IMAGE_BYTES) {
      toast.error(`${file.name} 超过 8MB`);
      return true;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      if (!isImageDataUrl(dataUrl)) {
        toast.error(`不支持的图片格式：${file.name}`);
        return true;
      }
      if (estimateDataUrlBytes(dataUrl) > MAX_IMAGE_CONTEXT_BYTES) {
        toast.error(`${file.name} 超过图片理解服务的体积限制（4MB）`);
        return true;
      }
      addAgentContextFile({
        id: generateUUID(),
        name: file.name,
        path: file.name,
        content: dataUrl,
        thumbnail: dataUrl,
        source: 'external',
        active: true,
        isImage: true,
        addedBy: 'manual',
      });
      toast.success(`已添加图片参考 ${file.name}（发送时将转写为文字描述）`);
    } catch {
      toast.error(`无法读取 ${file.name}`);
    }
    return true;
  }, [addAgentContextFile]);

  /**
   * P2 checkpoint 撤销：写回快照（edit）或删除新建文件（create），
   * 再同步 store 状态。
   */
  const handleRevert = useCallback(async (messageId: string) => {
    const state = useScriptWorkspaceStore.getState();
    const message = state.agentMessages.find((item) => item.id === messageId);
    const edit = message?.diff;
    const workspaceFs = getScriptWorkspaceFs();
    if (!edit || edit.applied !== true || edit.reverted) return;
    if (!state.workspaceRoot || !workspaceFs) return toast.error('工作区文件系统不可用');
    try {
      if (edit.kind === 'create') {
        await workspaceFs.remove(state.workspaceRoot, edit.filePath);
        toast.success(`已撤销：删除新建文件 ${edit.filePath}`);
      } else {
        // 快照优先，缺失时退回 original（旧会话消息无 snapshot 字段）
        const restore = edit.snapshot ?? edit.original;
        await workspaceFs.writeFile(state.workspaceRoot, edit.filePath, restore);
        toast.success(`已撤销：${edit.filePath} 已回滚到应用前内容`);
      }
      state.revertDiff(messageId);
    } catch (error) {
      toast.error(`撤销失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, []);

  /** 工作区目录 → 目录上下文条目（发送时按前缀收集成员文件） */
  const addWorkspaceFolderContext = useCallback((folderPath: string) => {
    const prefix = `${folderPath}/`;
    const count = files.filter((file) => file.path.startsWith(prefix)).length;
    if (count === 0) return toast.error('拖入的目录为空（或不包含工作区文件）');
    addAgentContextFile({
      id: `folder:${folderPath}`,
      name: `${folderPath.split('/').pop() || folderPath} (${count} 个文件)`,
      path: folderPath,
      source: 'workspace',
      active: false,
      isDirectory: true,
      addedBy: 'manual',
    });
  }, [files, addAgentContextFile]);

  /** 递归读取外部拖入的目录（webkitGetAsEntry），只收集文本文件 */
  const readExternalDirectory = useCallback(async (entry: FileSystemDirectoryEntry): Promise<{ name: string; path: string; content: string }[]> => {
    const reader = entry.createReader();
    const collected: { name: string; path: string; content: string }[] = [];
    const readBatch = (): Promise<FileSystemEntry[]> => new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    // readEntries 每次最多返回 100 条，循环读到空为止
    for (;;) {
      const batch = await readBatch();
      if (batch.length === 0) break;
      for (const child of batch) {
        if (collected.length >= MAX_DIRECTORY_CONTEXT_FILES) return collected;
        if (child.isDirectory) {
          collected.push(...await readExternalDirectory(child as FileSystemDirectoryEntry));
        } else if (child.isFile) {
          const fileEntry = child as FileSystemFileEntry;
          const file = await new Promise<File | null>((resolve) => fileEntry.file(resolve, () => resolve(null)));
          if (!file) continue;
          const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
          if (!CONTEXT_FILE_EXTENSIONS.has(extension) || file.size > MAX_CONTEXT_FILE_SIZE) continue;
          try {
            collected.push({ name: file.name, path: `${entry.fullPath}/${fileEntry.name}`.replace(/^\/+/, ''), content: await file.text() });
          } catch { /* 单文件失败跳过 */ }
        }
      }
    }
    return collected;
  }, []);

  const handleContextDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDraggingContext(false);
    // 1) 工作区文件夹（ProjectExplorer 目录拖拽）
    const workspaceFolder = event.dataTransfer.getData('application/x-moyin-script-folder');
    if (workspaceFolder) { addWorkspaceFolderContext(workspaceFolder); return; }
    // 2) 工作区文件（ProjectExplorer 文件拖拽）
    const workspacePath = event.dataTransfer.getData('application/x-moyin-script-file');
    if (workspacePath) { addWorkspaceContext(workspacePath); return; }
    // 3) 外部文件/文件夹（含目录递归）
    const items = Array.from(event.dataTransfer.items ?? []);
    const dirEntries = items
      .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
      .filter((entry): entry is FileSystemDirectoryEntry => entry?.isDirectory ?? false);
    if (dirEntries.length > 0) {
      for (const dirEntry of dirEntries) {
        try {
          const collected = await readExternalDirectory(dirEntry);
          if (collected.length === 0) { toast.error(`目录 ${dirEntry.name} 中没有可读取的文本文件`); continue; }
          // 外部目录展开为逐文件条目（保持与外部文件一致的语义）
          for (const file of collected) {
            addAgentContextFile({ id: generateUUID(), name: `${dirEntry.name}/${file.name}`, path: file.path, content: file.content, source: 'external', active: false, addedBy: 'manual' });
          }
          toast.success(`已导入目录 ${dirEntry.name}（${collected.length} 个文本文件）`);
        } catch {
          toast.error(`无法读取目录 ${dirEntry.name}`);
        }
      }
      return;
    }
    // 4) 普通外部文件（图片优先识别为图片参考）
    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length === 0) return;
    for (const file of droppedFiles) {
      // P2 图片参考：MIME image/* → dataURL 暂存，发送时转写
      if (await addImageContext(file)) continue;
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!CONTEXT_FILE_EXTENSIONS.has(extension)) { toast.error(`${file.name} 不是支持的文本文件`); continue; }
      if (file.size > MAX_CONTEXT_FILE_SIZE) { toast.error(`${file.name} 超过 2MB`); continue; }
      try {
        addAgentContextFile({ id: generateUUID(), name: file.name, path: file.name, content: await file.text(), source: 'external', active: false, addedBy: 'manual' });
      } catch { toast.error(`无法读取 ${file.name}`); }
    }
  }, [addWorkspaceContext, addWorkspaceFolderContext, readExternalDirectory, addAgentContextFile, addImageContext]);

  /**
   * 核心请求流程（handleSend 与 handleRegenerate 共用）：
   * 流式占位 → callFeatureAPIStream → reasoning/text 双通道 → 协议解析 → diff 落库。
   * 调用前须保证 user 消息已在 store 中（发送或截断保留）。
   */
  const runAgentRequest = useCallback(async (requestText: string, context: ReturnType<typeof buildAgentContext>) => {
    setAgentThinking(true);

    // 流式占位消息：先显示"生成中"，收到首个 delta 后逐字更新
    const streamMessageId = generateUUID();
    addAgentMessage({ id: streamMessageId, role: 'assistant', content: '…', timestamp: Date.now() });
    // 累积原始输出（含协议标记），渲染时用 renderStreamingText 过滤
    let rawAccum = '';
    let reasoningAccum = '';
    let received = 0;

    // 2.1 停止生成：AbortController 贯穿整条流式链路（panel → feature-router → chat-stream → fetch/SSE）
    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      // recentConversation 取自 store（截断/重新生成后已是最新的历史）
      const history = useScriptWorkspaceStore.getState().agentMessages;
      const recentConversation = history.slice(-8).map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const fullText = await callFeatureAPIStream(
        'script_analysis',
        SCRIPT_AGENT_SYSTEM_PROMPT,
        JSON.stringify({
          request: requestText,
          workspace: context,
          recentConversation,
        }),
        {
          temperature: 0.3,
          maxTokens: 8192,
          signal: abortController.signal,
          // ⑩ 会话内模型切换：未选时跟随功能默认绑定
          modelOverride: useScriptWorkspaceStore.getState().agentModelOverride ?? undefined,
        },
        {
          onText: (delta, event) => {
            if (event.type === 'reasoning') {
              // ⑥ 思考过程：增量聚合到 reasoning 字段（UI 折叠展示，不进正文）
              reasoningAccum += delta;
              useScriptWorkspaceStore.getState().updateAgentMessage(streamMessageId, '…', { reasoning: reasoningAccum });
              return;
            }
            received += delta.length;
            rawAccum += delta;
            useScriptWorkspaceStore.getState().updateAgentMessage(streamMessageId, renderStreamingText(rawAccum), reasoningAccum ? { reasoning: reasoningAccum } : undefined);
          },
        },
      );
      const parsed = parseAgentResponse(fullText);
      const state = useScriptWorkspaceStore.getState();
      const currentFiles = state.files;
      // P2 CREATE：路径校验 + 已存在降级为 edit（拒絕覆盖已有文件）；
      // EDIT 指向不存在文件时若路径合法，升级为 create（模型偶发用错标记的容错）
      const edits = parsed.edits.flatMap((edit): Array<{ edit: AgentEdit; originalFile: ScriptFileEntry | null }> => {
        const originalFile = currentFiles.find((file) => file.path === edit.filePath);
        if (edit.kind === 'create') {
          const invalid = validateCreatePath(edit.filePath);
          if (invalid) return [];  // 非法路径直接丢弃
          if (originalFile) {
            // 已存在 → 降级为修改（快照/original 取磁盘内容）
            return originalFile.content !== edit.proposedContent
              ? [{ edit: { ...edit, kind: 'edit' as const }, originalFile }]
              : [];
          }
          return [{ edit, originalFile: null }];
        }
        if (!originalFile) {
          // EDIT 指向不存在的文件：路径合法则升级为 create，否则丢弃
          return validateCreatePath(edit.filePath) ? [{ edit: { ...edit, kind: 'create' as const }, originalFile: null }] : [];
        }
        return originalFile.content !== edit.proposedContent ? [{ edit, originalFile }] : [];
      });
      if (edits.length === 0) {
        state.updateAgentMessage(streamMessageId, parsed.reply || '已完成分析。');
      } else {
        edits.forEach(({ edit, originalFile }, index) => {
          const diff = {
            filePath: edit.filePath,
            original: originalFile?.content ?? '',
            proposed: edit.proposedContent,
            applied: undefined,
            kind: (edit.kind ?? 'edit') as 'edit' | 'create',
          };
          if (index === 0) {
            // 第一条编辑复用流式消息，带上 diff
            useScriptWorkspaceStore.setState((state) => ({
              agentMessages: state.agentMessages.map((message) => message.id === streamMessageId ? {
                ...message,
                content: parsed.reply || `${edit.kind === 'create' ? '建议新建' : '建议修改'} ${edit.filePath}`,
                diff,
              } : message),
            }));
          } else {
            state.addAgentMessage({
              id: generateUUID(),
              role: 'assistant',
              content: `${edit.kind === 'create' ? '同时建议新建' : '同时建议修改'} ${edit.filePath}`,
              timestamp: Date.now(),
              diff,
            });
          }
        });
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        // 2.1 用户主动停止：不算错误 —— 保留已生成内容并追加停止标记
        const partial = renderStreamingText(rawAccum);
        useScriptWorkspaceStore.getState().updateAgentMessage(
          streamMessageId,
          partial.trim()
            ? `${partial}\n\n⏹ 已停止`
            : '⏹ 已停止',
        );
        return;
      }
      const message = error instanceof Error ? error.message : 'AI 调用失败';
      if (received === 0) {
        useScriptWorkspaceStore.getState().updateAgentMessage(streamMessageId, `❌ ${message}`);
      } else {
        // 已有部分输出时保留已生成内容，追加错误提示
        useScriptWorkspaceStore.getState().updateAgentMessage(
          streamMessageId,
          `${useScriptWorkspaceStore.getState().agentMessages.find((m) => m.id === streamMessageId)?.content ?? ''}\n\n⚠️ 连接中断：${message}`,
        );
      }
      toast.error(message);
    } finally {
      if (abortRef.current === abortController) abortRef.current = null;
      setAgentThinking(false);
    }
  }, [addAgentMessage, setAgentThinking, buildAgentContext]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || isAgentThinking) return;

    // P2 图片参考：发送前把勾选的图片经「图片理解」转写为文字描述。
    // 转写结果缓存在运行时 ref（不进持久化 store，避免 base64/大文本落盘）。
    const activeImages = useScriptWorkspaceStore.getState().agentContextFiles.filter((item) => item.isImage && item.active && item.content);
    const imageDescriptions: { name: string; description: string }[] = [];
    if (activeImages.length > 0) {
      setAgentThinking(true);
      for (const image of activeImages.slice(0, MAX_IMAGE_CONTEXT_COUNT)) {
        try {
          const description = await describeImage(image.content!);
          imageDescriptions.push({ name: image.name, description });
        } catch (error) {
          toast.error(`图片 ${image.name} 转写失败：${error instanceof Error ? error.message : '未知错误'}`);
        }
      }
      setAgentThinking(false);
      if (imageDescriptions.length === 0) return;  // 全部转写失败：中止发送，用户可移除图片后重试
    }

    const context = buildAgentContext();
    if (imageDescriptions.length > 0) {
      (context as { imageReferences?: { name: string; description: string }[] }).imageReferences = imageDescriptions;
    }
    const userMessage: AgentMessage = {
      id: generateUUID(),
      role: 'user',
      content: inputText.trim(),
      timestamp: Date.now(),
    };
    addAgentMessage(userMessage);
    setInputText('');
    // 2.3 自己发送的消息永远回底（即使之前上滚阅读历史）
    scrollToBottom();
    await runAgentRequest(userMessage.content, context);
  }, [inputText, isAgentThinking, addAgentMessage, buildAgentContext, scrollToBottom, runAgentRequest, setAgentThinking]);

  /** ⑤ 重新生成：截断该 assistant 消息（及其后所有消息），取触发它的 user 消息重发 */
  const handleRegenerate = useCallback(async (messageId: string) => {
    if (isAgentThinking) return;
    const index = agentMessages.findIndex((m) => m.id === messageId);
    if (index < 0) return;
    // 回溯找它前面最近的一条 user 消息；没有则无法重新生成
    let userIndex = -1;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (agentMessages[i].role === 'user') { userIndex = i; break; }
    }
    const userMessage = userIndex >= 0 ? agentMessages[userIndex] : null;
    // 截断：保留触发消息（含）之前的内容 —— 删除旧回复及之后的一切
    truncateAgentMessages(userIndex >= 0 ? userIndex + 1 : index);
    if (!userMessage) return toast.error('未找到对应的提问消息，无法重新生成');
    scrollToBottom();
    await runAgentRequest(userMessage.content, buildAgentContext());
  }, [isAgentThinking, agentMessages, truncateAgentMessages, buildAgentContext, scrollToBottom, runAgentRequest]);

  /** 2.1 停止生成：中止当前流式请求，保留已生成部分 */
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // 2.1 Escape 中止生成（仅生成中）
      if (e.key === 'Escape' && isAgentThinking) {
        e.preventDefault();
        handleStop();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, handleStop, isAgentThinking]
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
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-xs font-medium flex items-center gap-1.5 shrink-0">
            <MessageSquareIcon className="h-3.5 w-3.5" />
            剧本助手
          </span>
          {/* ⑩ 会话内模型切换：script_analysis 绑定的模型列表 */}
          {availableModels.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="ml-1 flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="切换剧本助手使用的模型"
                >
                  <CpuIcon className="h-3 w-3 shrink-0" />
                  <span className="max-w-40 truncate">{agentModelOverride ?? '默认模型'}</span>
                  <ChevronDownIcon className="h-3 w-3 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 max-h-64 overflow-y-auto">
                <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">模型（当前会话生效）</div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setAgentModelOverride(null)} className={cn(!agentModelOverride && 'bg-muted')}>
                  <span className="min-w-0 flex-1 truncate">默认（跟随功能绑定）</span>
                  {!agentModelOverride && <CheckIcon className="h-3 w-3 shrink-0" />}
                </DropdownMenuItem>
                {availableModels.map((model) => (
                  <DropdownMenuItem key={model} onSelect={() => setAgentModelOverride(model)} className={cn(agentModelOverride === model && 'bg-muted')}>
                    <span className="min-w-0 flex-1 truncate">{model}</span>
                    {agentModelOverride === model && <CheckIcon className="h-3 w-3 shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => { if (!isAgentThinking) { createAgentSession(); setInputText(''); } }} disabled={isAgentThinking} className="p-1 hover:bg-muted rounded transition-colors disabled:opacity-40" title="新建聊天"><PlusIcon className="h-3.5 w-3.5" /></button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="p-1 hover:bg-muted rounded transition-colors" title="历史聊天"><HistoryIcon className="h-3.5 w-3.5" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 max-h-80 overflow-y-auto">
              <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">历史聊天</div>
              {/* P2 会话搜索：标题与消息内容关键词过滤 */}
              <div className="px-2 pb-1.5">
                <div className="flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-1">
                  <SearchIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <input
                    value={sessionSearch}
                    onChange={(event) => setSessionSearch(event.target.value)}
                    placeholder="搜索标题或聊天内容…"
                    className="w-full bg-transparent text-[10px] outline-none placeholder:text-muted-foreground/60"
                  />
                  {sessionSearch && (
                    <button onClick={() => setSessionSearch('')} className="shrink-0 text-muted-foreground hover:text-foreground" title="清空搜索">
                      <XIcon className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {sessionSearch.trim() && (
                  <div className="mt-1 text-[9px] text-muted-foreground">
                    {searchAgentSessions(agentSessions, sessionSearch).length} / {agentSessions.length} 个聊天命中
                  </div>
                )}
              </div>
              <DropdownMenuSeparator />
              {agentSessions.length === 0 ? <div className="px-2 py-4 text-center text-xs text-muted-foreground">暂无聊天记录</div> : (
                searchAgentSessions(agentSessions, sessionSearch).length === 0
                  ? <div className="px-2 py-4 text-center text-xs text-muted-foreground">没有匹配「{sessionSearch.trim()}」的聊天</div>
                  : searchAgentSessions(agentSessions, sessionSearch).map(({ session, snippet }) => (
                <DropdownMenuItem key={session.id} onSelect={() => { if (!isAgentThinking) { selectAgentSession(session.id); setInputText(''); } }} className={cn('group flex items-center gap-2', session.id === agentSessionId && 'bg-muted')}>
                  <MessageSquareIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{session.title}</span>
                    <span className="block text-[9px] text-muted-foreground">{new Date(session.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {session.messages.length} 条消息</span>
                    {snippet && session.title.toLowerCase() !== snippet.toLowerCase() && (
                      <span className="block truncate text-[9px] text-primary/70">命中：{snippet}</span>
                    )}
                  </span>
                  <button
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      // Bug2 修复：生成中删除当前会话同样会让流式回调写空 ID，禁止
                      if (isAgentThinking && session.id === agentSessionId) {
                        toast.error('生成中，无法删除当前聊天（请先停止生成）');
                        return;
                      }
                      deleteAgentSession(session.id);
                    }}
                    className={cn(
                      'rounded p-1 opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100',
                      isAgentThinking && session.id === agentSessionId && 'opacity-40 cursor-not-allowed',
                    )}
                    title={isAgentThinking && session.id === agentSessionId ? '生成中，无法删除当前聊天' : '删除聊天'}
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </DropdownMenuItem>
              ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={() => {
              // Bug2 修复：生成中清空会让流式回调写已消失的消息 ID（消息凭空消失），
              // 先中止生成再清空
              if (isAgentThinking) {
                handleStop();
                toast.info('已停止生成，聊天已清空');
              }
              clearAgentMessages();
            }}
            className={cn(
              'p-1 hover:bg-muted rounded transition-colors',
              isAgentThinking && 'opacity-50',
            )}
            title={isAgentThinking ? '生成中：点击将先停止生成并清空聊天' : '清空当前聊天'}
          >
            <TrashIcon className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleMessagesScroll}
        className="relative flex-1 overflow-y-auto p-3 space-y-3"
      >
        {agentMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquareIcon className="h-10 w-10 mb-2 opacity-30" />
            <p className="text-xs">开始与 AI 助手对话</p>
            <p className="text-[10px] mt-1">询问剧本建议、分镜优化等</p>
          </div>
        )}

        {agentMessages.map((msg, index) => (
          <div
            key={msg.id}
            className={cn(
              "group flex flex-col",
              msg.role === 'user' ? "items-end" : "items-start"
            )}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-xs group/msg",
                msg.role === 'user'
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}
            >
              {msg.role === 'assistant' && msg.reasoning && (
                <ReasoningBlock text={msg.reasoning} streaming={isAgentThinking && index === agentMessages.length - 1} />
              )}
              {msg.role === 'assistant'
                ? <MarkdownContent text={msg.content} />
                : <div className="whitespace-pre-wrap">{msg.content}</div>
              }
              {msg.diff && (
                <DiffViewer
                  original={msg.diff.original}
                  proposed={msg.diff.proposed}
                  onApply={() => void applyAgentEdit(msg.id)}
                  onReject={() => rejectDiff(msg.id)}
                  applied={msg.diff.applied}
                  kind={msg.diff.kind}
                  reverted={msg.diff.reverted}
                  onRevert={() => void handleRevert(msg.id)}
                />
              )}
            </div>
            {/* P2 建议 chips：最后一条 assistant 消息且不在生成中时显示后续动作 */}
            {msg.role === 'assistant'
              && !isAgentThinking
              && index === agentMessages.length - 1
              && !msg.diff
              && msg.content.length > 0
              && !msg.content.startsWith('⏹')
              && !msg.content.startsWith('❌')
              && !msg.content.startsWith('✅')
              && !msg.content.startsWith('↩')
              && (
                <div className="flex max-w-[85%] flex-wrap gap-1">
                  {[
                    { label: '继续优化', prompt: '请继续深化刚才的分析，给出更具体的修改建议' },
                    { label: '提取结构', prompt: '请提取当前剧本的结构：列出场景、角色、地点和关键剧情节点' },
                    { label: '生成分镜描述', prompt: '请为当前剧本的关键场景撰写分镜描述（景别、画面、动作、台词）' },
                    { label: '导入蓝图', action: () => setShowImportPreview(true), disabled: currentShots.length === 0 },
                  ].map((chip) => (
                    <button
                      key={chip.label}
                      onClick={() => {
                        if ('action' in chip && chip.action) chip.action();
                        else if ('prompt' in chip && chip.prompt) setInputText(chip.prompt);
                      }}
                      disabled={'disabled' in chip ? chip.disabled : false}
                      className={cn(
                        'rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-muted/60 hover:text-foreground',
                        'disabled' in chip && chip.disabled && 'cursor-not-allowed opacity-50 hover:border-border hover:bg-muted/30',
                      )}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              )}
            <div className={cn(
              'flex items-center gap-1 transition-opacity',
              // hover 气泡所在整行时显示（含时间戳区域）
              'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
            )}>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(msg.content).then(
                    () => toast.success('已复制到剪贴板'),
                    () => toast.error('复制失败'),
                  );
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="复制消息内容"
              >
                <CopyIcon className="h-3 w-3" />
              </button>
              {msg.role === 'assistant' && (
                <button
                  onClick={() => void handleRegenerate(msg.id)}
                  disabled={isAgentThinking}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                  title={isAgentThinking ? '生成中，请稍后' : '基于原提问重新生成'}
                >
                  <RefreshCwIcon className="h-3 w-3" />
                </button>
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
              <span>
                {agentMessages.length > 0 && agentMessages[agentMessages.length - 1]?.role === 'assistant' && agentMessages[agentMessages.length - 1].content
                  ? '正在继续生成…'
                  : '思考中...'}
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />

        {/* 2.3 回到最新 —— 用户上滚离底后显示 */}
        {showJumpToLatest && (
          <button
            onClick={() => scrollToBottom()}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full border border-border bg-background/95 px-2.5 py-1 text-[10px] shadow-md backdrop-blur transition-colors hover:bg-muted"
            title="滚动到最新消息"
          >
            <ArrowDownIcon className="h-3 w-3" />
            回到最新
            {isAgentThinking && (
              <span className="flex gap-0.5">
                <span className="h-1 w-1 animate-pulse rounded-full bg-primary" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
              </span>
            )}
          </button>
        )}
      </div>

      {/* ⑧ 批量应用：多条未处理 diff 时显示 */}
      {pendingDiffCount > 1 && !isAgentThinking && (
        <div className="px-3 pb-2">
          <button
            onClick={() => void handleApplyAllPending()}
            className="w-full flex items-center justify-center gap-1 rounded-md border border-green-500/30 bg-green-500/5 px-2 py-1.5 text-[10px] text-green-600 hover:bg-green-500/10 transition-colors dark:text-green-400"
          >
            <CheckIcon className="h-3 w-3" />
            全部应用（{pendingDiffCount} 处修改）
          </button>
        </div>
      )}

      {/* Quick actions */}
      <div className="px-2 pb-1 flex flex-wrap gap-1">
        {[
          { label: '续写', tip: selection ? `从第 ${selection.line + 1} 行光标处继续创作` : '基于光标位置继续创作（请先在编辑器中定位）', disabled: !selection, action: () => {
            const sel = useScriptWorkspaceStore.getState().editorSelection;
            setInputText(sel ? `请从第 ${sel.line + 1} 行“${editorContent.split('\n')[sel.line]?.slice(0, 20) ?? ''}…”光标处继续续写，保持文风与格式一致` : '请继续续写当前剧本');
            textareaRef.current?.focus();
          } },
          { label: '改写', tip: selection?.text ? `优化选中的 ${selection.text.length} 字段落` : '请先在编辑器中选中要改写的段落', disabled: !selection?.text, action: () => {
            const sel = useScriptWorkspaceStore.getState().editorSelection;
            if (!sel?.text) return;
            setInputText(`请改写我选中的段落（第 ${sel.line + 1} 行起，${sel.text.length} 字），保持剧情走向：\n\n${sel.text.slice(0, 500)}`);
            textareaRef.current?.focus();
          } },
          { label: '提取结构', tip: '解析场景/角色/镜头信息', disabled: false, action: () => {
            setInputText('请提取当前剧本的结构：列出场景、角色、地点和关键剧情节点');
            textareaRef.current?.focus();
          } },
        ].map((item) => (
          <button
            key={item.label}
            onClick={item.action}
            disabled={item.disabled}
            className={cn(
              'px-2 py-0.5 text-[10px] rounded-full border transition-colors',
              item.disabled
                ? 'border-border text-muted-foreground/50 cursor-not-allowed'
                : 'border-border hover:bg-muted/50 hover:border-primary/30',
            )}
            title={item.tip}
          >
            {item.label}
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
                  {file.isImage
                    ? (file.thumbnail
                        ? <img src={file.thumbnail} alt={file.name} className="h-4 w-4 shrink-0 rounded-sm object-cover" />
                        : <ImageIcon className="h-3 w-3 shrink-0" />)
                    : file.isDirectory
                      ? <FolderIcon className="h-3 w-3 shrink-0" />
                      : <FileTextIcon className="h-3 w-3 shrink-0" />}
                  <span className="max-w-32 truncate">{file.name}</span>
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
          {isAgentThinking ? (
            <button
              onClick={handleStop}
              className="self-end p-1.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors animate-pulse"
              title="停止生成 (Esc)"
            >
              <SquareIcon className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              className={cn(
                "self-end p-1.5 rounded-md transition-colors",
                inputText.trim()
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              <SendIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
