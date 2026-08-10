// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type {
  BlueprintNode,
  BlueprintNodeData,
  MediaReferenceNodeConfig,
  BlueprintMediaRef,
} from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { generateUUID } from '@/lib/utils';
import {
  NodeCard,
  NodeLabel,
  NodeSection,
  NodeDropZone,
  NodeThumbnailGrid,
  NodeInfoRow,
  getNodeStatusColor,
} from './NodeUI';

function ImageReferenceNodeComponent({
  id,
  data,
  selected,
}: NodeProps<BlueprintNode>) {
  const nodeData = data as BlueprintNodeData;
  const config = (nodeData.config ?? { media: [] }) as MediaReferenceNodeConfig;
  const execution = nodeData.execution;
  const selectNode = useBlueprintStore((s) => s.selectNode);
  const updateNode = useBlueprintStore((s) => s.updateNode);

  const statusColor = getNodeStatusColor(execution?.status);
  const mediaItems = Array.isArray(config.media) ? config.media : [];

  const handleFiles = useCallback(
    (files: File[]) => {
      // Create object URLs for preview. The actual upload happens at execution time.
      const newMedia: BlueprintMediaRef[] = files.map((file) => ({
        url: URL.createObjectURL(file),
        localPath: file.name, // Store filename for display; actual path resolved later
        mimeType: file.type,
        dedupeKey: generateUUID(),
      }));
      updateNode(id, {
        config: { ...config, media: [...mediaItems, ...newMedia] },
      });
    },
    [id, config, mediaItems, updateNode],
  );

  const handleRemove = useCallback(
    (index: number) => {
      const next = [...mediaItems];
      const removed = next.splice(index, 1)[0];
      // Revoke object URL to prevent memory leak
      if (removed?.url?.startsWith('blob:')) URL.revokeObjectURL(removed.url);
      updateNode(id, {
        config: { ...config, media: next },
      });
    },
    [id, config, mediaItems, updateNode],
  );

  return (
    <NodeCard selected={selected} statusColor={statusColor} className="max-w-[260px]">
      <NodeLabel icon="🖼️" label={nodeData.label} />

      {mediaItems.length > 0 ? (
        <NodeSection>
          <NodeThumbnailGrid
            items={mediaItems}
            onRemove={handleRemove}
            maxVisible={4}
          />
          <NodeInfoRow label="参考图" value={`${mediaItems.length} 张`} />
        </NodeSection>
      ) : (
        <NodeSection>
          <NodeDropZone
            label="拖入图片或点击选择"
            onFiles={handleFiles}
            accept="image/*"
          />
        </NodeSection>
      )}

      {/* Add more images when some already exist */}
      {mediaItems.length > 0 && (
        <NodeDropZone
          label="+ 添加更多"
          onFiles={handleFiles}
          accept="image/*"
          className="mt-1 min-h-0 py-1"
        />
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="image"
        className="!bg-success"
      />
    </NodeCard>
  );
}

/** Memoized image reference node. */
export const ImageReferenceNode = memo(ImageReferenceNodeComponent);
