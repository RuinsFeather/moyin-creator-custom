// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Script Workspace Store
 * 
 * Manages the Agent-assisted script writing workspace state:
 * - Left panel: project file tree and local folder import
 * - Center panel: Markdown editor with auto-save and preview
 * - Right panel: Agent chat with diff confirmation and storyboard suggestions
 * 
 * This store is project-scoped using createProjectScopedStorage.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createProjectScopedStorage } from '@/lib/project-storage';

// ── Types ─────────────────────────────────────────────────────────────────

/** A file entry in the project file tree. */
export interface ScriptFileEntry {
  id: string;
  name: string;
  path: string;        // Relative path within project
  type: 'markdown' | 'script' | 'metadata';
  content: string;
  lastModified: number;
  isDirty: boolean;    // Has unsaved changes
  editable?: boolean;
  size?: number;
}

export interface ScriptDirectoryEntry {
  path: string;
  name: string;
}

export interface AgentContextFile {
  id: string;
  name: string;
  path: string;
  /** 外部拖入文件的正文；工作区文件正文始终从 files 中读取最新值。 */
  content?: string;
  source: 'workspace' | 'external';
  active: boolean;
  /**
   * 目录上下文：拖入整个文件夹时记录目录 path，
   * 发送时从 files 中收集该目录下所有文件。
   */
  isDirectory?: boolean;
  /**
   * P2 图片参考：拖入的图片以 dataURL 形式暂存，发送时经
   * 「图片理解」服务转写为文字描述后进上下文。base64 不持久化
   * （partialize 不含 agentContextFiles 中的图片 dataURL 字段，
   * 该字段只在会话内使用）。
   */
  isImage?: boolean;
  /** 图片缩略图（isImage=true 时的 dataURL，仅 UI 展示用） */
  thumbnail?: string;
  /**
   * 添加来源：
   *   - 'browse'  —— 资源管理器点选文件时自动带入的浏览参考（可被后续浏览替换）
   *   - 'manual'  —— 用户主动添加（拖拽/外部导入，不会被浏览替换移除）
   * 旧持久化数据无该字段时按 'manual' 保守处理（不做替换删除）。
   */
  addedBy?: 'browse' | 'manual';
}

/** An Agent conversation message. */
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** 推理模型思考过程（reasoning_content 增量聚合），UI 可折叠展示 */
  reasoning?: string;
  /** If the agent suggested a code/document change, this holds the diff. */
  diff?: {
    filePath: string;
    original: string;
    proposed: string;
    /** 是否已应用（undefined = 待确认） */
    applied?: boolean | undefined;
    /** P2：'create' = 新建文件（original 恒为空）；'edit' 或缺省 = 修改已有文件 */
    kind?: 'edit' | 'create';
    /** P2 checkpoint：应用前的工作区磁盘快照，供“撤销本次写入”回滚 */
    snapshot?: string | null;
    /** 撤销标记：true = 已回滚到 snapshot */
    reverted?: boolean;
  };
}

export interface AgentChatSession {
  id: string;
  title: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
}

export type EditorMode = 'edit' | 'preview' | 'split';

/** ⑦ 编辑器选区/光标上下文（由 MarkdownEditor 上报，agent context 使用） */
export interface EditorSelection {
  /** 选中文字（空串 = 无选区，仅光标） */
  text: string;
  /** 光标所在行（0 基） */
  line: number;
  /** 光标所在列（0 基） */
  column: number;
  /** editorContent 中的起始偏移 */
  startOffset: number;
  /** editorContent 中的结束偏移 */
  endOffset: number;
}

interface ScriptWorkspaceState {
  // ── File tree ──────────────────────────────────────────────────────
  files: ScriptFileEntry[];
  directories: ScriptDirectoryEntry[];
  workspaceRoot: string | null;
  activeFileId: string | null;
  
  // ── Editor ─────────────────────────────────────────────────────────
  editorMode: EditorMode;
  editorContent: string;         // Current editor content (may be unsaved)
  autoSaveEnabled: boolean;
  lastSavedAt: number | null;
  
  // ── Agent ──────────────────────────────────────────────────────────
  agentMessages: AgentMessage[];
  agentSessionId: string | null;
  agentSessions: AgentChatSession[];
  isAgentThinking: boolean;
  agentContextFiles: AgentContextFile[];
  /** ⑦ 编辑器选区/光标（agent 上下文使用；不持久化，随编辑器实时上报） */
  editorSelection: EditorSelection | null;
  /** ⑩ 会话级模型覆盖（script_analysis 功能可切换模型；null = 跟随功能默认） */
  agentModelOverride: string | null;
  
  // ── UI state ───────────────────────────────────────────────────────
  leftPanelWidth: number;        // 0-100 percentage
  rightPanelWidth: number;       // 0-100 percentage
  showAgent: boolean;
  showPreview: boolean;
}

interface ScriptWorkspaceActions {
  // ── File management ────────────────────────────────────────────────
  setFiles: (files: ScriptFileEntry[]) => void;
  setDirectories: (directories: ScriptDirectoryEntry[]) => void;
  setWorkspaceRoot: (root: string | null) => void;
  addFile: (file: ScriptFileEntry) => void;
  removeFile: (fileId: string) => void;
  setActiveFile: (fileId: string | null) => void;
  updateFileContent: (fileId: string, content: string) => void;
  markFileSaved: (fileId: string) => void;
  
  // ── Editor ─────────────────────────────────────────────────────────
  setEditorMode: (mode: EditorMode) => void;
  setEditorContent: (content: string) => void;
  setAutoSave: (enabled: boolean) => void;
  
  // ── Agent ──────────────────────────────────────────────────────────
  addAgentMessage: (message: AgentMessage) => void;
  clearAgentMessages: () => void;
  /** 流式输出时原地更新一条消息内容；partial 传入时只更新对应字段 */
  updateAgentMessage: (id: string, content: string, partial?: { reasoning?: string }) => void;
  /** 重新生成前截断消息列表：保留 endIndex（不含）之前的消息 */
  truncateAgentMessages: (endIndex: number) => void;
  setAgentSessionId: (id: string | null) => void;
  createAgentSession: () => string;
  selectAgentSession: (id: string) => void;
  deleteAgentSession: (id: string) => void;
  setAgentThinking: (thinking: boolean) => void;
  /** ⑦ 编辑器选区/光标变化时上报（textarea select/change keyup 事件） */
  setEditorSelection: (selection: EditorSelection | null) => void;
  /** ⑩ 会话内切换模型：null 恢复跟随功能默认绑定 */
  setAgentModelOverride: (model: string | null) => void;
  addAgentContextFile: (file: AgentContextFile) => void;
  removeAgentContextFile: (id: string) => void;
  toggleAgentContextFile: (id: string) => void;
  /**
   * 资源管理器浏览加入：替换上一个「未勾选」的浏览参考，
   * 已勾选（active）或手动添加（addedBy='manual'）的条目保留。
   */
  browseAgentContextFile: (file: AgentContextFile) => void;
  /** 刷新目录上下文条目（名称中的文件数统计） */
  refreshAgentContextFiles: () => void;
  applyDiff: (messageId: string, options?: { saved?: boolean }) => void;
  rejectDiff: (messageId: string) => void;
  /** P2 checkpoint 撤销：把 diff 对应文件回滚到应用前快照（create 删文件） */
  revertDiff: (messageId: string) => void;
  
  // ── UI ─────────────────────────────────────────────────────────────
  setLeftPanelWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  toggleAgent: () => void;
  togglePreview: () => void;
  collapseLeftPanel: () => void;
  collapseRightPanel: () => void;
  restorePanelDefaults: () => void;
}

type ScriptWorkspaceStore = ScriptWorkspaceState & ScriptWorkspaceActions;

// ── Store ─────────────────────────────────────────────────────────────────

export const useScriptWorkspaceStore = create<ScriptWorkspaceStore>()(
  persist(
    (set, get) => ({
      // Initial state
      files: [],
      directories: [],
      workspaceRoot: null,
      activeFileId: null,
      editorMode: 'edit' as EditorMode,
      editorContent: '',
      autoSaveEnabled: true,
      lastSavedAt: null,
      agentMessages: [] as AgentMessage[],
      agentSessionId: null,
      agentSessions: [] as AgentChatSession[],
      isAgentThinking: false,
      agentContextFiles: [] as AgentContextFile[],
      editorSelection: null,
      agentModelOverride: null,
      leftPanelWidth: 20,
      rightPanelWidth: 25,
      showAgent: true,
      showPreview: false,

      // File management
      setFiles: (files: ScriptFileEntry[]) => set({ files }),
      setDirectories: (directories: ScriptDirectoryEntry[]) => set({ directories }),
      setWorkspaceRoot: (workspaceRoot: string | null) => set({ workspaceRoot }),
      addFile: (file: ScriptFileEntry) => set((s) => ({ files: [...s.files, file] })),
      removeFile: (fileId: string) => set((s) => ({
        files: s.files.filter((f) => f.id !== fileId),
        activeFileId: s.activeFileId === fileId ? null : s.activeFileId,
      })),
      setActiveFile: (fileId: string | null) => {
        const state = get();
        // Save current content before switching
        if (state.activeFileId && state.editorContent) {
          set((s) => ({
            files: s.files.map((f) =>
              f.id === s.activeFileId
                ? { ...f, content: s.editorContent, isDirty: false }
                : f
            ),
          }));
        }
        const file = get().files.find((f) => f.id === fileId);
        set({
          activeFileId: fileId,
          editorContent: file?.content ?? '',
          lastSavedAt: null,
        });
      },
      updateFileContent: (fileId: string, content: string) => set((s) => ({
        editorContent: content,
        files: s.files.map((f) =>
          f.id === fileId ? { ...f, content, isDirty: true, lastModified: Date.now() } : f
        ),
      })),
      markFileSaved: (fileId: string) => set((s) => ({
        files: s.files.map((f) =>
          f.id === fileId ? { ...f, isDirty: false } : f
        ),
        lastSavedAt: Date.now(),
      })),

      // Editor
      setEditorMode: (mode: EditorMode) => set({ editorMode: mode }),
      setEditorContent: (content: string) => set({ editorContent: content }),
      setAutoSave: (enabled: boolean) => set({ autoSaveEnabled: enabled }),

      // Agent
      addAgentMessage: (message: AgentMessage) => set((s) => {
        const now = Date.now();
        const sessionId = s.agentSessionId ?? globalThis.crypto.randomUUID();
        const existing = s.agentSessions.find((session) => session.id === sessionId);
        const messages = [...(existing?.messages ?? s.agentMessages), message];
        const firstUserMessage = messages.find((item) => item.role === 'user')?.content.trim();
        const title = existing?.title ?? (firstUserMessage ? firstUserMessage.slice(0, 30) : '新聊天');
        const session: AgentChatSession = {
          id: sessionId,
          title,
          messages,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        return {
          agentSessionId: sessionId,
          agentMessages: messages,
          agentSessions: [session, ...s.agentSessions.filter((item) => item.id !== sessionId)],
        };
      }),
      clearAgentMessages: () => set((s) => ({
        agentMessages: [],
        agentSessions: s.agentSessions.map((session) =>
          session.id === s.agentSessionId ? { ...session, messages: [], updatedAt: Date.now() } : session
        ),
      })),
      /** 流式输出时原地更新一条消息的内容（不追加，不重排 session 列表） */
      updateAgentMessage: (id, content, partial) => set((s) => {
        const update = (message: AgentMessage): AgentMessage => message.id === id
          ? { ...message, content, ...(partial?.reasoning !== undefined ? { reasoning: partial.reasoning } : {}) }
          : message;
        const currentSessionId = s.agentSessionId;
        return {
          agentMessages: s.agentMessages.map(update),
          agentSessions: s.agentSessions.map((session) =>
            session.id === currentSessionId
              ? { ...session, messages: session.messages.map(update), updatedAt: Date.now() }
              : session
          ),
        };
      }),
      /** ⑤ 重新生成：截断到 endIndex（不含），同步当前会话的 messages */
      truncateAgentMessages: (endIndex) => set((s) => {
        const messages = s.agentMessages.slice(0, Math.max(0, endIndex));
        const currentSessionId = s.agentSessionId;
        return {
          agentMessages: messages,
          agentSessions: s.agentSessions.map((session) =>
            session.id === currentSessionId
              ? { ...session, messages, updatedAt: Date.now() }
              : session
          ),
        };
      }),
      setAgentSessionId: (id: string | null) => set({ agentSessionId: id }),
      createAgentSession: () => {
        const id = globalThis.crypto.randomUUID();
        const now = Date.now();
        set((s) => ({
          agentSessionId: id,
          agentMessages: [],
          agentSessions: [{ id, title: '新聊天', messages: [], createdAt: now, updatedAt: now }, ...s.agentSessions],
        }));
        return id;
      },
      selectAgentSession: (id: string) => set((s) => {
        const session = s.agentSessions.find((item) => item.id === id);
        return session ? { agentSessionId: id, agentMessages: session.messages } : {};
      }),
      deleteAgentSession: (id: string) => set((s) => {
        const remaining = s.agentSessions.filter((session) => session.id !== id);
        if (s.agentSessionId !== id) return { agentSessions: remaining };
        const next = remaining[0];
        return {
          agentSessions: remaining,
          agentSessionId: next?.id ?? null,
          agentMessages: next?.messages ?? [],
        };
      }),
      setAgentThinking: (thinking: boolean) => set({ isAgentThinking: thinking }),
      setEditorSelection: (selection) => set({ editorSelection: selection }),
      setAgentModelOverride: (model) => set({ agentModelOverride: model }),
      addAgentContextFile: (file: AgentContextFile) => set((s) => ({
        agentContextFiles: s.agentContextFiles.some((item) =>
          item.source === file.source && item.path === file.path
        ) ? s.agentContextFiles : [...s.agentContextFiles, file],
      })),
      removeAgentContextFile: (id: string) => set((s) => ({
        agentContextFiles: s.agentContextFiles.filter((file) => file.id !== id),
      })),
      toggleAgentContextFile: (id: string) => set((s) => ({
        agentContextFiles: s.agentContextFiles.map((file) =>
          file.id === id ? { ...file, active: !file.active } : file
        ),
      })),
      /**
       * 浏览参考替换：资源管理器每点选一个新文件，就移除上一个
       * 未勾选的浏览参考（addedBy='browse' 且 active=false），
       * 再把当前文件加入。已勾选的参考（active=true）与用户手动
       * 添加的条目（addedBy='manual'，含拖拽/外部导入/目录上下文）
       * 一律保留，不受浏览替换影响。
       */
      browseAgentContextFile: (file: AgentContextFile) => set((s) => {
        const isSame = (item: AgentContextFile) =>
          item.source === file.source && item.path === file.path;
        // 可移除 = 浏览参考 + 未勾选 + 非当前文件自身
        const removable = (item: AgentContextFile) =>
          item.addedBy === 'browse' && !item.active && !isSame(item);
        // 当前文件已在参考栏（无论勾选与否）：保留其现有状态，仅清理其它未勾选的浏览参考
        if (s.agentContextFiles.some(isSame)) {
          return {
            agentContextFiles: s.agentContextFiles.filter((item) => !removable(item)),
          };
        }
        return {
          agentContextFiles: [
            // 先清理旧浏览参考，再追加当前文件
            ...s.agentContextFiles.filter((item) => !removable(item)),
            { ...file, addedBy: 'browse' },
          ],
        };
      }),
      /** 用最新文件列表刷新目录上下文的名称/文件数（目录可能增删文件） */
      refreshAgentContextFiles: () => set((s) => ({
        agentContextFiles: s.agentContextFiles.map((item) => {
          if (!item.isDirectory) return item;
          const count = item.source === 'workspace'
            ? s.files.filter((file) => file.path.startsWith(`${item.path}/`)).length
            : 0;
          const suffix = count > 0 ? ` (${count} 个文件)` : '';
          const baseName = item.name.replace(/\s*\(\d+ 个文件\)$/, '');
          return { ...item, name: `${baseName}${suffix}` };
        }),
      })),
      /**
       * 应用 diff 到 files/编辑器。
       * @param options.saved  true = 磁盘已落盘（调用方先 writeFile），
       *   本次一并置 isDirty: false，避免“置脏再标保存”的中间态
       *   （Bug1：原 Panel 三步顺序耦合，任一步失败留下不一致状态）
       */
      applyDiff: (messageId: string, options?: { saved?: boolean }) => set((s) => {
        const msg = s.agentMessages.find((m) => m.id === messageId);
        if (!msg?.diff) return s;
        const target = msg.diff!;
        const saved = options?.saved === true;
        const updatedFiles = target.kind === 'create'
          // 新建：文件入列（磁盘写入由调用方在 applyAgentEdit 内先完成）
          ? (s.files.some((f) => f.path === target.filePath)
              ? s.files.map((f) => f.path === target.filePath ? { ...f, content: target.proposed, isDirty: !saved, lastModified: Date.now() } : f)
              : [...s.files, {
                  id: globalThis.crypto.randomUUID(),
                  name: target.filePath.split('/').pop() ?? target.filePath,
                  path: target.filePath,
                  type: 'markdown' as const,
                  content: target.proposed,
                  lastModified: Date.now(),
                  isDirty: !saved,
                  editable: true,
                }])
          // 修改：原路径覆写
          : s.files.map((f) =>
              f.path === target.filePath
                ? { ...f, content: target.proposed, isDirty: !saved, lastModified: Date.now() }
                : f
            );
        const activeFile = updatedFiles.find((f) => f.id === s.activeFileId);
        const agentMessages = s.agentMessages.map((m) =>
          m.id === messageId ? { ...m, diff: { ...m.diff!, applied: true, reverted: false } } : m
        );
        return {
          files: updatedFiles,
          editorContent: activeFile?.path === target.filePath
            ? target.proposed
            : s.editorContent,
          // saved 场景对齐原 markFileSaved：同步“最后保存时间”
          ...(saved ? { lastSavedAt: Date.now() } : {}),
          agentMessages,
          agentSessions: s.agentSessions.map((session) =>
            session.id === s.agentSessionId ? { ...session, messages: agentMessages, updatedAt: Date.now() } : session
          ),
        };
      }),
      rejectDiff: (messageId: string) => set((s) => {
        const agentMessages = s.agentMessages.map((m) =>
          m.id === messageId ? { ...m, diff: { ...m.diff!, applied: false } } : m
        );
        return {
          agentMessages,
          agentSessions: s.agentSessions.map((session) =>
            session.id === s.agentSessionId ? { ...session, messages: agentMessages, updatedAt: Date.now() } : session
          ),
        };
      }),
      /**
       * P2 checkpoint 撤销：回滚到应用前快照。
       * - edit：优先 snapshot（磁盘快照），缺失时退回 original；覆写回 files/editor
       * - create：从 files 中移除该文件（磁盘删除由调用方完成）
       * 只对 applied === true 且未撤销的 diff 生效；磁盘写入由 Panel 的
       * handleRevert 在调用本 action 前完成。
       */
      revertDiff: (messageId: string) => set((s) => {
        const msg = s.agentMessages.find((m) => m.id === messageId);
        if (!msg?.diff || msg.diff.applied !== true || msg.diff.reverted) return s;
        const target = msg.diff!;
        // 快照优先：旧会话消息无 snapshot 时退回 original
        const restore = target.snapshot ?? target.original;
        const updatedFiles = target.kind === 'create'
          ? s.files.filter((f) => f.path !== target.filePath)
          : s.files.map((f) =>
              f.path === target.filePath
                ? { ...f, content: restore, isDirty: true, lastModified: Date.now() }
                : f
            );
        const activeFile = updatedFiles.find((f) => f.id === s.activeFileId);
        const agentMessages = s.agentMessages.map((m) =>
          m.id === messageId ? { ...m, diff: { ...m.diff!, reverted: true } } : m
        );
        return {
          files: updatedFiles,
          editorContent: activeFile && activeFile.path === target.filePath
            ? restore
            : (s.activeFileId && !updatedFiles.some((f) => f.id === s.activeFileId) && target.kind === 'create'
                ? ''  // 活动文件是被删除的新建文件：清空编辑器
                : s.editorContent),
          agentMessages,
          agentSessions: s.agentSessions.map((session) =>
            session.id === s.agentSessionId ? { ...session, messages: agentMessages, updatedAt: Date.now() } : session
          ),
        };
      }),

      // UI
      setLeftPanelWidth: (width: number) => set({ leftPanelWidth: width }),
      setRightPanelWidth: (width: number) => set({ rightPanelWidth: width }),
      toggleAgent: () => set((s) => ({ showAgent: !s.showAgent })),
      togglePreview: () => set((s) => ({ showPreview: !s.showPreview })),
      collapseLeftPanel: () => set({ leftPanelWidth: 0 }),
      collapseRightPanel: () => set({ rightPanelWidth: 0 }),
      restorePanelDefaults: () => set({ leftPanelWidth: 20, rightPanelWidth: 25, showAgent: true }),
    }),
    {
      name: 'script-workspace',
      storage: createJSONStorage(() => createProjectScopedStorage('script-workspace')),
      version: 3,
      partialize: (state) => ({
        files: state.files,
        directories: state.directories,
        workspaceRoot: state.workspaceRoot,
        activeFileId: state.activeFileId,
        editorMode: state.editorMode,
        autoSaveEnabled: state.autoSaveEnabled,
        lastSavedAt: state.lastSavedAt,
        leftPanelWidth: state.leftPanelWidth,
        rightPanelWidth: state.rightPanelWidth,
        showAgent: state.showAgent,
        showPreview: state.showPreview,
        // P2：图片参考的 dataURL 不持久化（体积可达数 MB，会撑爆 localStorage 配额）；
        // 重启后图片条目消失，用户可重新拖入
        agentContextFiles: state.agentContextFiles.filter((item) => !item.isImage),
        agentMessages: state.agentMessages,
        agentSessionId: state.agentSessionId,
        agentSessions: state.agentSessions,
      }),
    },
  ),
);
