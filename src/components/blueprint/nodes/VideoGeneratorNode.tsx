// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useCallback, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type {
  BlueprintNode,
  BlueprintNodeData,
  BlueprintVideoGeneratorConfig,
} from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import {
  NodeCard,
  NodeLabel,
  NodeSection,
  NodeSelect,
  NodeTextarea,
  NodeInfoRow,
  NodeProgress,
  NodeError,
  getNodeStatusColor,
} from './NodeUI';
import { ASPECT_RATIOS } from './constants';

const VIDEO_MODELS = [
  { value: '', label: '默认' },
  { value: 'doubao-seed-1-0-pro', label: '豆包 Seed 1.0 Pro' },
  { value: 'doubao-seed-1-0-lite', label: '豆包 Seed 1.0 Lite' },
  { value: 'veo-3.0', label: 'Veo 3.0' },
  { value: 'veo-2.0', label: 'Veo 2.0' },
] as const;

const VIDEO_DURATIONS = [
  { value: '5', label: '5 秒' },
  { value: '10', label: '10 秒' },
  { value: '15', label: '15 秒' },
] as const;

function VideoGeneratorNodeComponent({
  id,
  data,
  selected,
}: NodeProps<BlueprintNode>) {
  const nodeData = data as BlueprintNodeData;
  const config = (nodeData.config ?? {}) as BlueprintVideoGeneratorConfig;
  const execution = nodeData.execution;
  const selectNode = useBlueprintStore((s) => s.selectNode);
  const updateNode = useBlueprintStore((s) => s.updateNode);

  const statusColor = getNodeStatusColor(execution?.status);
  const progress = execution?.progress;

  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateConfig = useCallback(
    (patch: Partial<BlueprintVideoGeneratorConfig>) => {
      updateNode(id, { config: { ...config, ...patch } });
    },
    [id, config, updateNode],
  );

  const refCount = config.referenceMediaRefs?.length ?? 0;

  return (
    <NodeCard selected={selected} statusColor={statusColor}>
      <NodeLabel icon="🎥" label={nodeData.label}>
        <button
          className="nodrag ml-auto text-[9px] text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            setShowAdvanced((v) => !v);
          }}
        >
          {showAdvanced ? '收起 ▲' : '配置 ▾'}
        </button>
      </NodeLabel>

      {/* Progress indicator */}
      {execution?.status === 'running' && typeof progress === 'number' && (
        <NodeProgress progress={progress} />
      )}

      {/* Prompt display */}
      <NodeSection>
        <div className="rounded border border-border bg-background p-1 text-[10px] text-muted-foreground">
          {config.prompt ? (
            <span className="text-foreground">
              {config.prompt.slice(0, 80)}{config.prompt.length > 80 && '…'}
            </span>
          ) : (
            <span className="italic">等待上游 prompt 输入</span>
          )}
        </div>
      </NodeSection>

      {/* Model + duration */}
      <NodeSection className="flex gap-1.5">
        <div className="flex-1">
          <label className="mb-0.5 block text-[9px] text-muted-foreground">模型</label>
          <NodeSelect
            value={config.model ?? ''}
            onChange={(model) => updateConfig({ model })}
            options={[...VIDEO_MODELS] as readonly { value: string; label: string }[]}
          />
        </div>
        <div className="flex-1">
          <label className="mb-0.5 block text-[9px] text-muted-foreground">时长</label>
          <NodeSelect
            value={config.duration ? String(config.duration) : ''}
            onChange={(duration) => updateConfig({ duration: duration ? Number(duration) : undefined })}
            options={[...VIDEO_DURATIONS] as readonly { value: string; label: string }[]}
          />
        </div>
      </NodeSection>

      {/* Advanced config */}
      {showAdvanced && (
        <NodeSection className="space-y-1.5 border-t border-border pt-1.5">
          <div>
            <label className="mb-0.5 block text-[9px] text-muted-foreground">比例</label>
            <NodeSelect
              value={config.aspectRatio ?? ''}
              onChange={(aspectRatio) => updateConfig({ aspectRatio })}
              options={[{ value: '', label: '默认' }, ...ASPECT_RATIOS] as readonly { value: string; label: string }[]}
            />
          </div>
          <div>
            <label className="mb-0.5 block text-[9px] text-muted-foreground">分辨率</label>
            <NodeTextarea
              rows={1}
              value={config.resolution ?? ''}
              onChange={(resolution) => updateConfig({ resolution })}
              placeholder="如 1080p"
            />
          </div>
          {refCount > 0 && (
            <NodeInfoRow label="参考素材" value={`${refCount} 个`} />
          )}
        </NodeSection>
      )}

      {/* Reference media badge */}
      {refCount > 0 && !showAdvanced && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-success">
          <span>🎬 {refCount} 参考素材</span>
        </div>
      )}

      {/* Error display */}
      {execution?.error && <NodeError message={execution.error} />}

      {/* Input handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        className="!bg-info"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="reference-media"
        className="!bg-success"
        style={{ top: '65%' }}
      />

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        className="!bg-destructive"
      />
    </NodeCard>
  );
}

/** Video generator node — prompt-driven video generation with reference media. */
export const VideoGeneratorNode = memo(VideoGeneratorNodeComponent);
