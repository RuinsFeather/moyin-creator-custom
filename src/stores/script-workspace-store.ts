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
}

/** An Agent conversation message. */
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** If the agent suggested a code/document change, this holds the diff. */
  diff?: {
    filePath: string;
    original: string;
    proposed: string;
    applied: boolean | undefined;
  };
}

export interface AgentChatSession {
  id: string;
  title: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
}

/** A storyboard suggestion from the Agent. */
export interface StoryboardSuggestion {
  id: string;
  shotIndex: number;
  title: string;
  description: string;
  prompt: string;
  accepted: boolean | null; // null = pending, true = accepted, false = rejected
  sourceMessageId: string;
}

export type EditorMode = 'edit' | 'preview' | 'split';

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
  storyboardSuggestions: StoryboardSuggestion[];
  agentContextFiles: AgentContextFile[];
  
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
  setAgentSessionId: (id: string | null) => void;
  createAgentSession: () => string;
  selectAgentSession: (id: string) => void;
  deleteAgentSession: (id: string) => void;
  setAgentThinking: (thinking: boolean) => void;
  addStoryboardSuggestion: (suggestion: StoryboardSuggestion) => void;
  updateSuggestionStatus: (suggestionId: string, accepted: boolean) => void;
  clearStoryboardSuggestions: () => void;
  addAgentContextFile: (file: AgentContextFile) => void;
  removeAgentContextFile: (id: string) => void;
  toggleAgentContextFile: (id: string) => void;
  applyDiff: (messageId: string) => void;
  rejectDiff: (messageId: string) => void;
  
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
      storyboardSuggestions: [] as StoryboardSuggestion[],
      agentContextFiles: [] as AgentContextFile[],
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
        storyboardSuggestions: [],
        agentSessions: s.agentSessions.map((session) =>
          session.id === s.agentSessionId ? { ...session, messages: [], updatedAt: Date.now() } : session
        ),
      })),
      setAgentSessionId: (id: string | null) => set({ agentSessionId: id }),
      createAgentSession: () => {
        const id = globalThis.crypto.randomUUID();
        const now = Date.now();
        set((s) => ({
          agentSessionId: id,
          agentMessages: [],
          storyboardSuggestions: [],
          agentSessions: [{ id, title: '新聊天', messages: [], createdAt: now, updatedAt: now }, ...s.agentSessions],
        }));
        return id;
      },
      selectAgentSession: (id: string) => set((s) => {
        const session = s.agentSessions.find((item) => item.id === id);
        return session ? { agentSessionId: id, agentMessages: session.messages, storyboardSuggestions: [] } : {};
      }),
      deleteAgentSession: (id: string) => set((s) => {
        const remaining = s.agentSessions.filter((session) => session.id !== id);
        if (s.agentSessionId !== id) return { agentSessions: remaining };
        const next = remaining[0];
        return {
          agentSessions: remaining,
          agentSessionId: next?.id ?? null,
          agentMessages: next?.messages ?? [],
          storyboardSuggestions: [],
        };
      }),
      setAgentThinking: (thinking: boolean) => set({ isAgentThinking: thinking }),
      addStoryboardSuggestion: (suggestion: StoryboardSuggestion) => set((s) => ({
        storyboardSuggestions: [...s.storyboardSuggestions, suggestion],
      })),
      updateSuggestionStatus: (suggestionId: string, accepted: boolean) => set((s) => ({
        storyboardSuggestions: s.storyboardSuggestions.map((sug) =>
          sug.id === suggestionId ? { ...sug, accepted } : sug
        ),
      })),
      clearStoryboardSuggestions: () => set({ storyboardSuggestions: [] }),
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
      applyDiff: (messageId: string) => set((s) => {
        const msg = s.agentMessages.find((m) => m.id === messageId);
        if (!msg?.diff) return s;
        const updatedFiles = s.files.map((f) =>
          f.path === msg.diff!.filePath
            ? { ...f, content: msg.diff!.proposed, isDirty: true, lastModified: Date.now() }
            : f
        );
        const activeFile = updatedFiles.find((f) => f.id === s.activeFileId);
        const agentMessages = s.agentMessages.map((m) =>
          m.id === messageId ? { ...m, diff: { ...m.diff!, applied: true } } : m
        );
        return {
          files: updatedFiles,
          editorContent: activeFile?.path === msg.diff!.filePath
            ? msg.diff!.proposed
            : s.editorContent,
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
        agentContextFiles: state.agentContextFiles,
        agentMessages: state.agentMessages,
        agentSessionId: state.agentSessionId,
        agentSessions: state.agentSessions,
      }),
    },
  ),
);
