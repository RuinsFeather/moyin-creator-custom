// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useCallback, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type {
  BlueprintNode,
  BlueprintNodeData,
  BlueprintImageGeneratorConfig,
} from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import {
  NodeCard,
  NodeLabel,
  NodeSection,
  NodeSelect,
  NodeTextarea,
  NodeInput,
  NodeInfoRow,
  NodeProgress,
  NodeError,
  getNodeStatusColor,
} from './NodeUI';
import { IMAGE_MODELS, ASPECT_RATIOS, RESOLUTIONS } from './constants';

function ImageGeneratorNodeComponent({
  id,
  data,
  selected,
}: NodeProps<BlueprintNode>) {
  const nodeData = data as BlueprintNodeData;
  const config = (nodeData.config ?? {}) as BlueprintImageGeneratorConfig;
  const execution = nodeData.execution;
  const selectNode = useBlueprintStore((s) => s.selectNode);
  const updateNode = useBlueprintStore((s) => s.updateNode);

  const statusColor = getNodeStatusColor(execution?.status);
  const progress = execution?.progress;

  // Toggle showing advanced config
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateConfig = useCallback(
    (patch: Partial<BlueprintImageGeneratorConfig>) => {
      updateNode(id, { config: { ...config, ...patch } });
    },
    [id, config, updateNode],
  );

  const promptLabel = config.prompt?.length
    ? `${config.prompt.length} 字符`
    : '等待上游输入';

  return (
    <NodeCard selected={selected} statusColor={statusColor}>
      <NodeLabel icon="🎨" label={nodeData.label}>
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
            <span className="text-foreground">{config.prompt.slice(0, 80)}{config.prompt.length > 80 && '…'}</span>
          ) : (
            <span className="italic">等待上游 prompt 输入</span>
          )}
        </div>
      </NodeSection>

      {/* Model and quick settings */}
      <NodeSection className="flex gap-1.5">
        <div className="flex-1">
          <label className="mb-0.5 block text-[9px] text-muted-foreground">模型</label>
          <NodeSelect
            value={config.model ?? ''}
            onChange={(model) => updateConfig({ model })}
            options={[{ value: '', label: '默认' }, ...IMAGE_MODELS]}
          />
        </div>
        <div className="flex-1">
          <label className="mb-0.5 block text-[9px] text-muted-foreground">比例</label>
          <NodeSelect
            value={config.aspectRatio ?? '1:1'}
            onChange={(aspectRatio) => updateConfig({ aspectRatio })}
            options={ASPECT_RATIOS}
          />
        </div>
      </NodeSection>

      {/* Advanced config (collapsible) */}
      {showAdvanced && (
        <NodeSection className="space-y-1.5 border-t border-border pt-1.5">
          <div>
            <label className="mb-0.5 block text-[9px] text-muted-foreground">分辨率</label>
            <NodeSelect
              value={config.resolution ?? ''}
              onChange={(resolution) => updateConfig({ resolution })}
              options={[{ value: '', label: '跟随比例' }, ...RESOLUTIONS]}
            />
          </div>

          <div>
            <label className="mb-0.5 block text-[9px] text-muted-foreground">负向提示词</label>
            <NodeTextarea
              value={config.negativePrompt ?? ''}
              onChange={(negativePrompt) => updateConfig({ negativePrompt })}
              placeholder="不想出现的内容…"
              rows={2}
            />
          </div>

          {/* Reference images count info */}
          {config.referenceImageRefs && config.referenceImageRefs.length > 0 && (
            <NodeInfoRow
              label="参考图"
              value={`${config.referenceImageRefs.length} 张`}
            />
          )}
        </NodeSection>
      )}

      {/* Error display */}
      {execution?.error && <NodeError message={execution.error} />}

      {/* Reference images badge */}
      {config.referenceImageRefs && config.referenceImageRefs.length > 0 && !showAdvanced && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-success">
          <span>🖼️ {config.referenceImageRefs.length} 参考图</span>
        </div>
      )}

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
        id="reference-images"
        className="!bg-success"
        style={{ top: '65%' }}
      />

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="image"
        className="!bg-success"
      />
    </NodeCard>
  );
}

/** Memoized image generator node. */
export const ImageGeneratorNode = memo(ImageGeneratorNodeComponent);
