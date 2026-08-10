// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useCallback, useState } from 'react';
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
import { useAssetUpload } from '@/hooks/use-asset-upload';
import { VolcAssetPanel, type VolcAssetItem } from '@/components/panels/freedom/VolcAssetPanel';

function VideoReferenceNodeComponent({
  id,
  data,
  selected,
}: NodeProps<BlueprintNode>) {
  const nodeData = data as BlueprintNodeData;
  const config = (nodeData.config ?? { media: [] }) as MediaReferenceNodeConfig;
  const execution = nodeData.execution;
  const selectNode = useBlueprintStore((s) => s.selectNode);
  const updateNode = useBlueprintStore((s) => s.updateNode);
  const { uploadFiles, uploading } = useAssetUpload();

  const [assetDialogOpen, setAssetDialogOpen] = useState(false);

  const statusColor = getNodeStatusColor(execution?.status);
  const mediaItems = Array.isArray(config.media) ? config.media : [];

  // 拖放/点选本地文件 → 生成预览；真正上传到素材库由"上传到素材库"按钮触发
  const handleFiles = useCallback(
    (files: File[]) => {
      const newMedia: BlueprintMediaRef[] = files.map((file) => ({
        url: URL.createObjectURL(file),
        localPath: file.name,
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
      if (removed?.url?.startsWith('blob:')) URL.revokeObjectURL(removed.url);
      updateNode(id, { config: { ...config, media: next } });
    },
    [id, config, mediaItems, updateNode],
  );

  // 一键上传到素材库：选择本地图片，上传后以 assetId/volcAssetUri 引用持久化
  const handleUploadToLibrary = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? []);
      if (files.length === 0) return;
      const results = await uploadFiles(files);
      if (results.length === 0) return;
      const newRefs: BlueprintMediaRef[] = results.map((r) => ({
        url: r.url,
        localPath: r.name,
        mimeType: 'image/' + (r.name.match(/\.(jpe?g|png|webp|gif|bmp)$/i)?.[1] ?? 'png'),
        assetId: r.assetId,
        volcAssetUri: r.assetUri,
        mediaId: r.assetId,
        dedupeKey: generateUUID(),
      }));
      updateNode(id, {
        config: { ...config, media: [...mediaItems, ...newRefs] },
      });
    };
    input.click();
  }, [uploadFiles, id, config, mediaItems, updateNode]);

  // 从素材库选择已有资产
  const handleSelectAsset = useCallback(
    (asset: VolcAssetItem) => {
      const ref: BlueprintMediaRef = {
        url: asset.url,
        localPath: asset.name,
        assetId: asset.assetId,
        volcAssetUri: asset.assetUri,
        mediaId: asset.assetId,
        dedupeKey: generateUUID(),
      };
      updateNode(id, {
        config: { ...config, media: [...mediaItems, ref] },
      });
      setAssetDialogOpen(false);
    },
    [id, config, mediaItems, updateNode],
  );

  return (
    <NodeCard selected={selected} statusColor={statusColor} className="max-w-[260px]">
      <NodeLabel icon="🎬" label={nodeData.label} />

      {mediaItems.length > 0 ? (
        <NodeSection>
          <NodeThumbnailGrid items={mediaItems} onRemove={handleRemove} maxVisible={4} />
          <NodeInfoRow label="参考素材" value={`${mediaItems.length} 个`} />
        </NodeSection>
      ) : (
        <NodeSection>
          <NodeDropZone
            label="拖入图片/视频或点击选择"
            onFiles={handleFiles}
            accept="image/*,video/*"
          />
        </NodeSection>
      )}

      {mediaItems.length > 0 && (
        <NodeDropZone
          label="+ 添加更多"
          onFiles={handleFiles}
          accept="image/*,video/*"
          className="mt-1 min-h-0 py-1"
        />
      )}

      {/* 上传到素材库 + 从素材库选择 */}
      <NodeSection>
        <div className="flex gap-1">
          <button
            className="nodrag flex-1 rounded border border-input bg-muted/40 px-1.5 py-1 text-[10px] text-foreground transition-colors hover:bg-muted disabled:opacity-40"
            onClick={handleUploadToLibrary}
            disabled={uploading}
          >
            {uploading ? '上传中...' : '⬆ 上传到素材库'}
          </button>
          <button
            className="nodrag flex-1 rounded border border-input bg-muted/40 px-1.5 py-1 text-[10px] text-foreground transition-colors hover:bg-muted"
            onClick={() => setAssetDialogOpen(true)}
          >
            🗂 素材库
          </button>
        </div>
      </NodeSection>

      <Handle
        type="source"
        position={Position.Right}
        id="video"
        className="!bg-destructive"
      />

      <VolcAssetPanel
        open={assetDialogOpen}
        onOpenChange={setAssetDialogOpen}
        onSelectAsset={handleSelectAsset}
        selectedAssetIds={mediaItems.filter((m) => m.assetId).map((m) => m.assetId!)}
      />
    </NodeCard>
  );
}

/** Video reference node — supports local files, upload-to-library and asset selection. */
export const VideoReferenceNode = memo(VideoReferenceNodeComponent);
