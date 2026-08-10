// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type {
  BlueprintNode,
  BlueprintNodeData,
  OutputNodeConfig,
  BlueprintMediaRef,
} from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import {
  NodeCard,
  NodeLabel,
  NodeSection,
  NodeInfoRow,
  NodeThumbnailGrid,
  NodeError,
  getNodeStatusColor,
} from './NodeUI';

/** Badge color per accepted media type. */
const TYPE_BADGE: Record<string, string> = {
  image: 'bg-success/20 text-success',
  video: 'bg-destructive/20 text-destructive',
  audio: 'bg-warning/20 text-warning',
};

function OutputNodeComponent({
  id,
  data,
  selected,
}: NodeProps<BlueprintNode>) {
  const nodeData = data as BlueprintNodeData;
  const config = (nodeData.config ?? {
    acceptedTypes: ['image'],
  }) as OutputNodeConfig;
  const execution = nodeData.execution;
  const selectNode = useBlueprintStore((s) => s.selectNode);
  const updateNode = useBlueprintStore((s) => s.updateNode);

  const statusColor = getNodeStatusColor(execution?.status);

  const outputRef = execution?.output ?? nodeData.output;
  const hasOutput = execution?.status === 'completed' && outputRef != null;

  // Normalize output to array for thumbnail display
  const outputItems: BlueprintMediaRef[] = outputRef
    ? Array.isArray(outputRef)
      ? outputRef
      : [outputRef]
    : [];

  const handleToggleType = useCallback(
    (type: 'image' | 'video' | 'audio') => {
      const types = config.acceptedTypes ?? [];
      const next = types.includes(type)
        ? types.filter((t) => t !== type)
        : [...types, type];
      // Ensure at least one type is selected
      if (next.length === 0) return;
      updateNode(id, { config: { ...config, acceptedTypes: next } });
    },
    [id, config, updateNode],
  );

  return (
    <NodeCard selected={selected} statusColor={statusColor} className="max-w-[260px]">
      <NodeLabel icon="📦" label={nodeData.label} />

      {/* Accepted types */}
      <NodeSection>
        <div className="mb-0.5 text-[9px] text-muted-foreground">接收类型</div>
        <div className="flex flex-wrap gap-1">
          {(['image', 'video', 'audio'] as const).map((type) => {
            const isActive = config.acceptedTypes?.includes(type);
            return (
              <button
                key={type}
                className={`nodrag rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  isActive
                    ? TYPE_BADGE[type]
                    : 'bg-muted/50 text-muted-foreground/50'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleType(type);
                }}
              >
                {type === 'image' ? '🖼️ 图片' : type === 'video' ? '🎬 视频' : '🔊 音频'}
              </button>
            );
          })}
        </div>
      </NodeSection>

      {/* Output preview */}
      {hasOutput && (
        <NodeSection>
          <div className="text-[10px] font-medium text-success">✓ 已有结果</div>
          {outputItems.length > 0 && (
            <NodeThumbnailGrid items={outputItems} maxVisible={3} />
          )}
          {outputItems.length > 0 && (
            <NodeInfoRow label="结果数量" value={`${outputItems.length} 个`} />
          )}

          {/* Timeline preview: 若为多个结果，以时间线形式展示顺序片段 */}
          {outputItems.length > 1 && (
            <div className="mt-1">
              <div className="mb-0.5 text-[9px] text-muted-foreground">时间线预览</div>
              <div className="flex h-8 items-stretch gap-0.5 overflow-hidden rounded border border-border bg-muted/40 p-0.5">
                {outputItems.slice(0, 12).map((item, i) => {
                  const isVideo = item.mimeType?.startsWith('video/');
                  return (
                    <div
                      key={item.dedupeKey ?? item.url ?? i}
                      className={`group relative min-w-0 flex-1 overflow-hidden rounded-sm border ${
                        isVideo
                          ? 'border-destructive/40 bg-destructive/10'
                          : 'border-success/30 bg-success/10'
                      }`}
                      title={`片段 ${i + 1}${isVideo ? ' · 视频' : ' · 图片'}`}
                    >
                      {item.url ? (
                        <img
                          src={item.url}
                          alt={`片段 ${i + 1}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[8px] text-muted-foreground">
                          {i + 1}
                        </div>
                      )}
                      <span className="absolute bottom-0 left-0 right-0 bg-black/50 px-0.5 text-center text-[7px] leading-3 text-white">
                        {i + 1}
                      </span>
                    </div>
                  );
                })}
              </div>
              {outputItems.length > 12 && (
                <div className="mt-0.5 text-[8px] text-muted-foreground">
                  共 {outputItems.length} 个片段，仅预览前 12 个
                </div>
              )}
            </div>
          )}
        </NodeSection>
      )}

      {/* Waiting state */}
      {!hasOutput && (
        <NodeSection>
          <div className="text-[10px] text-muted-foreground">等待生成结果…</div>
        </NodeSection>
      )}

      {/* Error display */}
      {execution?.error && <NodeError message={execution.error} />}

      {/* Input handle: accepts multiple media types */}
      <Handle
        type="target"
        position={Position.Left}
        id="media"
        className="!bg-warning"
      />
    </NodeCard>
  );
}

/** Memoized output collector node. */
export const OutputNode = memo(OutputNodeComponent);
