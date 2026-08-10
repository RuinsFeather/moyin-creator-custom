// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useCallback, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type {
  BlueprintNode,
  BlueprintNodeData,
  ScriptImportNodeConfig,
} from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { useScriptStore } from '@/stores/script-store';
import {
  NodeCard,
  NodeLabel,
  NodeSection,
  NodeSelect,
  NodeInfoRow,
} from './NodeUI';

const MODE_OPTIONS = [
  { value: 'snapshot', label: '快照模式' },
];

function ScriptImportNodeComponent({
  id,
  data,
  selected,
}: NodeProps<BlueprintNode>) {
  const nodeData = data as BlueprintNodeData;
  const config = (nodeData.config ?? {
    selectedShotIds: [],
    mode: 'snapshot',
  }) as ScriptImportNodeConfig;
  const selectNode = useBlueprintStore((s) => s.selectNode);
  const updateNode = useBlueprintStore((s) => s.updateNode);

  // Read shots from the script store for the current active project
  const activeProjectId = useBlueprintStore((s) => s.activeProjectId);
  const scriptProject = useScriptStore((s) =>
    activeProjectId ? s.projects[activeProjectId] : null,
  );
  const shots = scriptProject?.shots ?? [];
  const scriptData = scriptProject?.scriptData;
  const scenes = scriptData?.scenes ?? [];

  // Selected set for quick lookup
  const selectedSet = useMemo(
    () => new Set(config.selectedShotIds),
    [config.selectedShotIds],
  );

  const handleToggleShot = useCallback(
    (shotId: string) => {
      const next = selectedSet.has(shotId)
        ? config.selectedShotIds.filter((sid) => sid !== shotId)
        : [...config.selectedShotIds, shotId];
      updateNode(id, { config: { ...config, selectedShotIds: next } });
    },
    [id, config, selectedSet, updateNode],
  );

  const handleSelectAll = useCallback(() => {
    const allIds = shots.map((s) => s.id);
    updateNode(id, {
      config: { ...config, selectedShotIds: allIds },
    });
  }, [id, config, shots, updateNode]);

  const handleClearAll = useCallback(() => {
    updateNode(id, { config: { ...config, selectedShotIds: [] } });
  }, [id, config, updateNode]);

  const handleModeChange = useCallback(
    (mode: string) => {
      updateNode(id, { config: { ...config, mode: mode as ScriptImportNodeConfig['mode'] } });
    },
    [id, config, updateNode],
  );

  // Group shots by scene for organized display
  const shotsByScene = useMemo(() => {
    const groups = new Map<string, typeof shots>();
    for (const shot of shots) {
      const key = shot.sceneRefId ?? 'unknown';
      const arr = groups.get(key) ?? [];
      arr.push(shot);
      groups.set(key, arr);
    }
    return groups;
  }, [shots]);

  const getSceneName = (sceneRefId: string) => {
    const scene = scenes.find(
      (s: { id: string }) => s.id === sceneRefId,
    );
    return scene?.name ?? `场景 ${sceneRefId.slice(0, 6)}`;
  };

  const isProjectReady = shots.length > 0;

  return (
    <NodeCard selected={selected} statusColor="border-border" className="max-w-[280px]">
      <NodeLabel icon="📜" label={nodeData.label} />

      {/* Mode selector */}
      <NodeSection className="flex items-center gap-1.5">
        <label className="text-[9px] text-muted-foreground">模式</label>
        <NodeSelect
          value={config.mode}
          onChange={handleModeChange}
          options={MODE_OPTIONS}
          className="flex-1"
        />
      </NodeSection>

      {/* Shot list */}
      {isProjectReady ? (
        <NodeSection>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">
              分镜 ({config.selectedShotIds.length}/{shots.length})
            </span>
            <div className="flex gap-1">
              <button
                className="nodrag text-[9px] text-primary hover:underline"
                onClick={(e) => { e.stopPropagation(); handleSelectAll(); }}
              >
                全选
              </button>
              <button
                className="nodrag text-[9px] text-muted-foreground hover:underline"
                onClick={(e) => { e.stopPropagation(); handleClearAll(); }}
              >
                清空
              </button>
            </div>
          </div>

          <div className="nodrag max-h-[120px] space-y-0.5 overflow-y-auto rounded border border-border bg-background p-1">
            {Array.from(shotsByScene.entries()).map(([sceneRefId, sceneShots]) => (
              <div key={sceneRefId}>
                <div className="text-[9px] font-medium text-muted-foreground">
                  {getSceneName(sceneRefId)}
                </div>
                {sceneShots.map((shot) => (
                  <label
                    key={shot.id}
                    className="flex cursor-pointer items-start gap-1 rounded px-0.5 py-0.5 hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="nodrag mt-0.5 h-3 w-3 shrink-0"
                      checked={selectedSet.has(shot.id)}
                      onChange={() => handleToggleShot(shot.id)}
                    />
                    <span className="text-[10px] text-foreground leading-tight">
                      <span className="text-muted-foreground">#{shot.index + 1}</span>{' '}
                      {shot.actionSummary?.slice(0, 40) ?? '（无描述）'}
                      {(shot.actionSummary?.length ?? 0) > 40 && '…'}
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </NodeSection>
      ) : (
        <NodeSection>
          <div className="rounded border border-dashed border-muted-foreground/40 bg-muted/20 p-2 text-center text-[10px] text-muted-foreground">
            请先在剧本板块生成分镜
          </div>
        </NodeSection>
      )}

      <NodeInfoRow label="快照模式" value="导入时冻结数据" />

      <Handle
        type="source"
        position={Position.Right}
        id="context"
        className="!bg-warning"
      />
    </NodeCard>
  );
}

/** Script import snapshot node. */
export const ScriptImportNode = memo(ScriptImportNodeComponent);
