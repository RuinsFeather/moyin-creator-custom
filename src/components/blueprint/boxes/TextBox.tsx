// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// TextBox — the "text-box" canvas window. §2.2 / P1-3.
//
// The window itself IS the editor: an inline textarea that saves straight
// into config on every change (via updateNode → undo stack). Content is
// always shown (not hidden behind a title until selected), matching the
// "content-first" design principle.
//
// AI assist is a local popover attached to the text window. It also exposes
// skill loading through AIAssistPanel and is independent of node selection.

import { memo, useCallback, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Maximize2 } from 'lucide-react';
import type { BlueprintNode, BlueprintNodeData, TextBoxConfig } from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { NodeSection, NodeTextarea } from '../nodes/NodeUI';
import { AIAssistPanel } from '../AIAssistPanel';
import { BoxShell } from './BoxShell';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function TextBoxComponent({ id, data, selected }: NodeProps<BlueprintNode>) {
  const nodeData = data as BlueprintNodeData;
  const config = (nodeData.config ?? { text: '' }) as TextBoxConfig;
  const execution = nodeData.execution;
  const updateNode = useBlueprintStore((s) => s.updateNode);
  const [showAI, setShowAI] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const patchConfig = useCallback(
    (patch: Partial<TextBoxConfig>) => {
      updateNode(id, { config: { ...config, ...patch } });
    },
    [id, config, updateNode],
  );

  const handleAIAssistClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowAI((open) => !open);
    },
    [],
  );

  const handleExpandClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(true);
  }, []);

  const charCount = typeof config.text === 'string' ? config.text.length : 0;
  const isFromShot = nodeData.sourceRef?.kind === 'shot';

  return (
    <BoxShell
      id={id}
      nodeType="text-box"
      selected={selected}
      icon="📝"
      label={nodeData.label}
      execution={execution}
      width={280}
      headerExtra={
        <>
          {isFromShot && (
            <span className="ml-1 shrink-0 rounded bg-info/15 px-1 text-[9px] text-info">
              分镜
            </span>
          )}
          {charCount > 0 && (
            <span className="ml-auto text-[9px] tabular-nums text-muted-foreground">
              {charCount}
            </span>
          )}
          <button
            onClick={handleExpandClick}
            className={`nodrag shrink-0 rounded px-1 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${
              charCount === 0 ? 'ml-auto' : 'ml-1'
            }`}
            title="放大编辑"
            aria-label="放大编辑"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
          <button
            onClick={handleAIAssistClick}
            className={`nodrag shrink-0 rounded px-1 py-0.5 text-[9px] transition-colors ${
              showAI
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            } ml-1`}
            title="AI 写作助手"
          >
            ✨
          </button>
        </>
      }
    >
      <NodeSection>
        <NodeTextarea
          value={typeof config.text === 'string' ? config.text : ''}
          onChange={(text) => patchConfig({ text })}
          placeholder="输入提示词、台词或上下文…"
          rows={4}
          className="h-[188px]"
        />
      </NodeSection>

      {showAI && (
        <div
          className="nodrag nowheel absolute left-0 top-full z-30 mt-2 h-[360px] w-[280px]"
          onClick={(event) => event.stopPropagation()}
        >
          <AIAssistPanel
            currentText={config.text ?? ''}
            role={config.role}
            language={config.language}
            skillRefs={config.skillRefs}
            onSkillRefsChange={(skillRefs) => patchConfig({ skillRefs })}
            onApplyText={(text) => patchConfig({ text })}
            onClose={() => setShowAI(false)}
          />
        </div>
      )}

      {/* 放大编辑弹窗：长文本编辑时提供更大的输入区域 */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="flex h-[70vh] w-[min(720px,calc(100%-2rem))] max-w-none flex-col gap-3"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <span>📝</span>
              <span className="truncate">{nodeData.label || '文本窗口'}</span>
              <span className="ml-auto text-[10px] font-normal tabular-nums text-muted-foreground">
                {charCount} 字
              </span>
            </DialogTitle>
          </DialogHeader>
          <textarea
            autoFocus
            value={typeof config.text === 'string' ? config.text : ''}
            onChange={(e) => patchConfig({ text: e.target.value })}
            placeholder="输入提示词、台词或上下文…"
            className="min-h-0 flex-1 resize-none rounded-md border border-input bg-background p-3 text-sm leading-relaxed text-foreground outline-none focus:border-primary"
          />
        </DialogContent>
      </Dialog>
    </BoxShell>
  );
}

/** Memoized text-box window. */
export const TextBox = memo(TextBoxComponent);
