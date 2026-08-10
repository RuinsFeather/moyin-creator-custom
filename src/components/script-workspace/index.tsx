// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ScriptWorkspace — Agent-assisted script writing workspace.
 * 
 * Three-column layout with resizable, collapsible panels:
 * - Left: ProjectExplorer (file tree + folder import)
 * - Center: MarkdownEditor (edit + auto-save + preview)
 * - Right: ScriptAgentPanel (chat + diff + storyboard suggestions)
 * 
 * Panel widths are persisted per-project via script-workspace-store.
 */

import { useCallback } from 'react';
import { ProjectExplorer } from './ProjectExplorer';
import { MarkdownEditor } from './MarkdownEditor';
import { ScriptAgentPanel } from './ScriptAgentPanel';
import { useScriptWorkspaceStore } from '@/stores/script-workspace-store';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { MessageSquareIcon, MessageSquareOffIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';

export function ScriptWorkspace() {
  const {
    showAgent,
    toggleAgent,
    leftPanelWidth,
    rightPanelWidth,
    setLeftPanelWidth,
    setRightPanelWidth,
    collapseLeftPanel,
    restorePanelDefaults,
  } = useScriptWorkspaceStore();

  // Save panel widths on resize
  const handleLayout = useCallback(
    (sizes: number[]) => {
      // sizes[0] = left, sizes[1] = center, sizes[2] = right (if agent shown)
      if (sizes.length >= 2) {
        setLeftPanelWidth(sizes[0]);
      }
      if (sizes.length >= 3) {
        setRightPanelWidth(sizes[2]);
      }
    },
    [setLeftPanelWidth, setRightPanelWidth]
  );

  const isLeftCollapsed = leftPanelWidth === 0;

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-panel">
        <div className="flex items-center gap-2">
          <button
            onClick={isLeftCollapsed ? restorePanelDefaults : collapseLeftPanel}
            className="p-1 hover:bg-muted rounded transition-colors"
            title={isLeftCollapsed ? '显示文件树' : '隐藏文件树'}
          >
            {isLeftCollapsed ? (
              <PanelLeftOpenIcon className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftCloseIcon className="h-3.5 w-3.5" />
            )}
          </button>
          <span className="text-xs font-medium">剧本工作台</span>
        </div>
        <button
          onClick={toggleAgent}
          className="p-1 hover:bg-muted rounded transition-colors"
          title={showAgent ? '隐藏助手' : '显示助手'}
        >
          {showAgent ? (
            <MessageSquareIcon className="h-3.5 w-3.5" />
          ) : (
            <MessageSquareOffIcon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Three-column layout */}
      <ResizablePanelGroup
        direction="horizontal"
        className="flex-1 min-h-0"
        onLayout={handleLayout}
      >
        {/* Left: File tree (collapsible) */}
        {!isLeftCollapsed && (
          <>
            <ResizablePanel
              defaultSize={leftPanelWidth}
              minSize={12}
              maxSize={30}
              className="min-w-0"
            >
              <ProjectExplorer />
            </ResizablePanel>

            <ResizableHandle />
          </>
        )}

        {/* Center: Editor */}
        <ResizablePanel
          defaultSize={showAgent ? 100 - leftPanelWidth - rightPanelWidth : 100 - leftPanelWidth}
          minSize={30}
          className="min-w-0"
        >
          <MarkdownEditor />
        </ResizablePanel>

        {/* Right: Agent panel */}
        {showAgent && (
          <>
            <ResizableHandle />
            <ResizablePanel
              defaultSize={rightPanelWidth}
              minSize={18}
              maxSize={40}
              className="min-w-0"
            >
              <ScriptAgentPanel />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
