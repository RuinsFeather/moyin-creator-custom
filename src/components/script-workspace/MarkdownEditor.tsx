// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * MarkdownEditor — Center panel of the script workspace.
 * 
 * Provides:
 * - Plain text editing with syntax-aware textarea
 * - Auto-save with debounce
 * - Split view with preview
 * - Keyboard shortcuts (Ctrl+S to save, Ctrl+P to toggle preview)
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useScriptWorkspaceStore } from '@/stores/script-workspace-store';
import { cn } from '@/lib/utils';
import {
  SaveIcon,
  EyeIcon,
  SplitIcon,
  Edit3Icon,
  CheckIcon,
  ClapperboardIcon,
  PersonStandingIcon,
  UserRoundIcon,
  ParenthesesIcon,
  MessageCircleIcon,
  ArrowRightLeftIcon,
  MessageSquareDashedIcon,
  CaptionsIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { getScriptWorkspaceFs } from '@/lib/script-workspace-fs';
import { buildEditorSelection } from '@/lib/script-workspace/agent-selection';

type ScriptElementType = 'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition' | 'comment' | 'subtitle';

const SCRIPT_ELEMENTS: Array<{
  type: ScriptElementType;
  label: string;
  shortcut: string;
  icon: typeof ClapperboardIcon;
  description: string;
}> = [
  { type: 'scene', label: '场次', shortcut: 'Alt+1', icon: ClapperboardIcon, description: '插入场次标题' },
  { type: 'action', label: '动作', shortcut: 'Alt+2', icon: PersonStandingIcon, description: '插入动作描写' },
  { type: 'character', label: '角色', shortcut: 'Alt+3', icon: UserRoundIcon, description: '插入角色名称' },
  { type: 'parenthetical', label: '括号', shortcut: 'Alt+4', icon: ParenthesesIcon, description: '插入角色语气或动作' },
  { type: 'dialogue', label: '对话', shortcut: 'Alt+5', icon: MessageCircleIcon, description: '插入角色对白' },
  { type: 'transition', label: '转场', shortcut: 'Alt+6', icon: ArrowRightLeftIcon, description: '插入转场提示' },
  { type: 'comment', label: '注释', shortcut: 'Alt+7', icon: MessageSquareDashedIcon, description: '插入不会显示在预览中的注释' },
  { type: 'subtitle', label: '字幕', shortcut: 'Alt+8', icon: CaptionsIcon, description: '插入画面字幕' },
];

function formatScriptElement(type: ScriptElementType, selectedText: string): { text: string; placeholder: string } {
  const selected = selectedText.trim();
  switch (type) {
    case 'scene': return { text: `## 场次：${selected || '时间 / 内外景 / 地点'}`, placeholder: selected ? '' : '时间 / 内外景 / 地点' };
    case 'action': return { text: `△ ${selected || '描述人物动作、环境和画面变化'}`, placeholder: selected ? '' : '描述人物动作、环境和画面变化' };
    case 'character': return { text: `**${selected || '角色名'}**`, placeholder: selected ? '' : '角色名' };
    case 'parenthetical': return { text: `（${selected || '语气或动作'}）`, placeholder: selected ? '' : '语气或动作' };
    case 'dialogue': return { text: `**角色名**：${selected || '对白内容'}`, placeholder: selected ? '角色名' : '对白内容' };
    case 'transition': return { text: `【转场：${selected || '切至下一场'}】`, placeholder: selected ? '' : '切至下一场' };
    case 'comment': return { text: `<!-- ${selected || '创作注释'} -->`, placeholder: selected ? '' : '创作注释' };
    case 'subtitle': return { text: `【字幕：${selected || '画面字幕内容'}】`, placeholder: selected ? '' : '画面字幕内容' };
  }
}

/** Simple markdown-to-HTML for preview (no external dependency). */
function simpleMarkdownToHtml(md: string): string {
  if (!md) return '';
  let html = md
    // Fenced code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
      `<pre><code class="language-${lang}">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`)
    // Headers
    .replace(/^###### (.+)$/gm, '<h6>$1</h6>')
    .replace(/^##### (.+)$/gm, '<h5>$1</h5>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr/>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered list items
    .replace(/^[\s]*[-*+] (.+)$/gm, '<li>$1</li>')
    // Ordered list items
    .replace(/^[\s]*\d+\. (.+)$/gm, '<li>$1</li>')
    // Inline code (before bold/italic to avoid conflicts)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%"/>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Bold/italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    // Paragraphs: double newline → paragraph break
    .replace(/\n\n/g, '</p><p>')
    // Single newline → line break
    .replace(/\n/g, '<br/>')
    // Wrap in paragraphs
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>(\s*<br\/>\s*<li>.*?<\/li>)*)/g, (match) => {
    const cleaned = match.replace(/<br\/>/g, '');
    return `<ul>${cleaned}</ul>`;
  });
  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\s*<br\/>\s*<blockquote>/g, '<br/>');
  // Fix empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  return html;
}

export function MarkdownEditor() {
  const {
    activeFileId,
    editorContent,
    editorMode,
    autoSaveEnabled,
    lastSavedAt,
    files,
    workspaceRoot,
    setEditorContent,
    setEditorMode,
    updateFileContent,
    markFileSaved,
  } = useScriptWorkspaceStore();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setEditorSelection = useScriptWorkspaceStore((s) => s.setEditorSelection);

  const activeFile = useMemo(
    () => files.find((f) => f.id === activeFileId),
    [files, activeFileId]
  );

  const saveActiveFile = useCallback(async () => {
    const workspaceFs = getScriptWorkspaceFs();
    if (!activeFileId || !activeFile || !workspaceRoot || !workspaceFs) {
      if (activeFileId) toast.error('文件未挂载到磁盘工作区');
      return;
    }
    setSaveStatus('saving');
    try {
      await workspaceFs.writeFile(workspaceRoot, activeFile.path, editorContent);
      markFileSaved(activeFileId);
      setSaveStatus('saved');
    } catch (error) {
      setSaveStatus('unsaved');
      toast.error(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [activeFileId, activeFile, workspaceRoot, editorContent, markFileSaved]);

  // Auto-save with debounce
  useEffect(() => {
    if (!autoSaveEnabled || !activeFileId || !activeFile?.isDirty) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    setSaveStatus('unsaved');
    autoSaveTimerRef.current = setTimeout(() => { void saveActiveFile(); }, 1500); // 1.5s debounce

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [editorContent, autoSaveEnabled, activeFileId, activeFile?.isDirty, saveActiveFile]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      setEditorContent(newContent);
      if (activeFileId) {
        updateFileContent(activeFileId, newContent);
      }
    },
    [activeFileId, setEditorContent, updateFileContent]
  );

  const handleManualSave = useCallback(() => { void saveActiveFile(); }, [saveActiveFile]);

  // ⑦ 选区/光标上报：select（含拖选/双击）+ keyup（方向键移动光标）都同步到 store
  const reportSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setEditorSelection(buildEditorSelection(editorContent, textarea.selectionStart, textarea.selectionEnd));
  }, [editorContent, setEditorSelection]);

  // 切换文件/内容被外部替换时清空选区（偏移可能已失效）
  useEffect(() => {
    setEditorSelection(null);
  }, [activeFileId, setEditorSelection]);

  const insertScriptElement = useCallback((type: ScriptElementType) => {
    const textarea = textareaRef.current;
    if (!textarea || !activeFileId) return;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const selectedText = editorContent.slice(selectionStart, selectionEnd);
    const lineStart = editorContent.lastIndexOf('\n', selectionStart - 1) + 1;
    const lineEndIndex = editorContent.indexOf('\n', selectionEnd);
    const lineEnd = lineEndIndex === -1 ? editorContent.length : lineEndIndex;
    const currentLine = editorContent.slice(lineStart, lineEnd);
    const replaceWholeLine = selectedText.length === 0 && currentLine.trim().length === 0;
    const insertionStart = replaceWholeLine ? lineStart : selectionStart;
    const insertionEnd = replaceWholeLine ? lineEnd : selectionEnd;
    const formatted = formatScriptElement(type, selectedText);
    const needsLeadingBreak = insertionStart > 0 && editorContent[insertionStart - 1] !== '\n';
    const needsTrailingBreak = insertionEnd < editorContent.length && editorContent[insertionEnd] !== '\n';
    const insertedText = `${needsLeadingBreak ? '\n' : ''}${formatted.text}${needsTrailingBreak ? '\n' : ''}`;
    const nextContent = editorContent.slice(0, insertionStart) + insertedText + editorContent.slice(insertionEnd);
    setEditorContent(nextContent);
    updateFileContent(activeFileId, nextContent);

    requestAnimationFrame(() => {
      textarea.focus();
      const contentOffset = insertionStart + (needsLeadingBreak ? 1 : 0);
      const placeholderIndex = formatted.placeholder ? formatted.text.indexOf(formatted.placeholder) : -1;
      if (placeholderIndex >= 0) {
        const start = contentOffset + placeholderIndex;
        textarea.setSelectionRange(start, start + formatted.placeholder.length);
      } else {
        const caret = contentOffset + formatted.text.length;
        textarea.setSelectionRange(caret, caret);
      }
    });
  }, [activeFileId, editorContent, setEditorContent, updateFileContent]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleManualSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setEditorMode(editorMode === 'preview' ? 'edit' : 'preview');
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-8]$/.test(e.key)) {
        e.preventDefault();
        const element = SCRIPT_ELEMENTS[Number(e.key) - 1];
        if (element) insertScriptElement(element.type);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleManualSave, editorMode, setEditorMode, insertScriptElement]);

  const previewHtml = useMemo(
    () => simpleMarkdownToHtml(editorContent),
    [editorContent]
  );

  if (!activeFileId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Edit3Icon className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">选择左侧文件开始编辑</p>
          <p className="text-xs mt-1">或创建新文档</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-panel">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium truncate max-w-[200px]">
            {activeFile?.name ?? '未命名'}
          </span>
          {activeFile?.isDirty && (
            <span className="text-[10px] text-yellow-500">● 未保存</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Save status */}
          <span className={cn(
            "text-[10px] mr-2",
            saveStatus === 'saved' && "text-green-500",
            saveStatus === 'saving' && "text-yellow-500",
            saveStatus === 'unsaved' && "text-muted-foreground",
          )}>
            {saveStatus === 'saved' && <><CheckIcon className="h-3 w-3 inline mr-0.5" />已保存</>}
            {saveStatus === 'saving' && '保存中...'}
            {saveStatus === 'unsaved' && '未保存'}
          </span>

          {/* Mode toggle */}
          <button
            onClick={() => setEditorMode('edit')}
            className={cn(
              "p-1 rounded transition-colors",
              editorMode === 'edit' ? "bg-primary/10 text-primary" : "hover:bg-muted"
            )}
            title="编辑模式"
          >
            <Edit3Icon className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setEditorMode('split')}
            className={cn(
              "p-1 rounded transition-colors",
              editorMode === 'split' ? "bg-primary/10 text-primary" : "hover:bg-muted"
            )}
            title="分屏模式"
          >
            <SplitIcon className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setEditorMode('preview')}
            className={cn(
              "p-1 rounded transition-colors",
              editorMode === 'preview' ? "bg-primary/10 text-primary" : "hover:bg-muted"
            )}
            title="预览模式"
          >
            <EyeIcon className="h-3.5 w-3.5" />
          </button>

          {/* Save button */}
          <button
            onClick={handleManualSave}
            className="p-1 hover:bg-muted rounded transition-colors ml-1"
            title="保存 (Ctrl+S)"
          >
            <SaveIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 min-h-0 flex">
        {/* Edit pane */}
        {(editorMode === 'edit' || editorMode === 'split') && (
          <div className={cn(
            "relative flex-1 min-w-0",
            editorMode === 'split' && "border-r border-border"
          )}>
            <textarea
              ref={textareaRef}
              value={editorContent}
              onChange={handleChange}
              onSelect={reportSelection}
              onKeyUp={reportSelection}
              className="w-full h-full px-4 pt-4 pb-20 resize-none bg-transparent text-sm leading-relaxed focus:outline-none font-mono"
              placeholder="开始写作..."
              spellCheck={false}
            />
            <div className="absolute inset-x-3 bottom-3 z-10 flex justify-center pointer-events-none">
              <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 border border-border bg-popover/95 p-1 shadow-lg backdrop-blur-sm rounded-md">
                {SCRIPT_ELEMENTS.map((element) => {
                  const Icon = element.icon;
                  return (
                    <button
                      key={element.type}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertScriptElement(element.type)}
                      className="flex h-8 shrink-0 items-center gap-1 px-2 text-[11px] text-muted-foreground rounded hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                      title={`${element.description} (${element.shortcut})`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{element.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Preview pane */}
        {editorMode !== 'edit' && (
          <div className={cn(
            "flex-1 min-w-0 overflow-y-auto p-4 prose prose-sm max-w-none",
            "prose-headings:text-foreground prose-p:text-foreground",
            "prose-strong:text-foreground prose-em:text-foreground"
          )}>
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-border text-[10px] text-muted-foreground">
        <span>{editorContent.length} 字符 · {editorContent.split('\n').length} 行</span>
        <span>Markdown · UTF-8</span>
      </div>
    </div>
  );
}
