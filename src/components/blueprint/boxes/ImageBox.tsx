// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// ImageBox — the "image-box" canvas window. §2.2 / P1-4.
//
// Content-first container: shows current image (import or generation result).
// No mode distinction — drag-in imports, generation results write back.
// Download button via saveFreedomMedia (same as 自由 image studio).
// Full parameter configuration lives in BoxConfigDrawer (P2).

import { memo, useCallback, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import type {
  BlueprintNode,
  BlueprintNodeData,
  BlueprintMediaRef,
  ImageBoxConfig,
} from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { generateUUID } from '@/lib/utils';
import { useAssetUpload } from '@/hooks/use-asset-upload';
import { VolcAssetPanel, type VolcAssetItem } from '@/components/panels/freedom/VolcAssetPanel';
import { saveFreedomMedia } from '@/lib/freedom/download-utils';
import { persistFilesAsRefs } from '@/lib/blueprint/blueprint-media';
import { NodeSection, NodeDropZone } from '../nodes/NodeUI';
import { ImagePreview } from './MediaPreview';
import { BoxShell } from './BoxShell';

function ImageBoxComponent({ id, data, selected }: NodeProps<BlueprintNode>) {
  const nodeData = data as BlueprintNodeData;
  const config = (nodeData.config ?? { media: [] }) as ImageBoxConfig;
  const execution = nodeData.execution;
  const updateNode = useBlueprintStore((s) => s.updateNode);
  const { uploadFiles, uploading } = useAssetUpload();
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);

  const media = Array.isArray(config.media) ? config.media : [];
  // 显示优先级：执行结果（生成完成写入 execution.output）→ 手动导入的最后一项。
  // 旧实现只读 config.media，生成完成后窗口不更新。
  const execOutput = execution?.output;
  const outputRef = Array.isArray(execOutput)
    ? execOutput[execOutput.length - 1]
    : execOutput;
  const current = outputRef ?? media[media.length - 1];

  const patchConfig = useCallback(
    (patch: Partial<ImageBoxConfig>) => {
      updateNode(id, { config: { ...config, ...patch } });
    },
    [id, config, updateNode],
  );

  // 拖放/点选本地文件 → 持久化为 local-image://（重启后仍有效；
  // 非 Electron 降级 data URL）。旧实现用 blob: URL，重载后失效且
  // 无法被上传链路识别，导致 "Invalid asset data" 报错。
  const handleFiles = useCallback(
    (files: File[]) => {
      void persistFilesAsRefs(files).then((newMedia) => {
        patchConfig({ media: [...media, ...newMedia] });
      });
    },
    [media, patchConfig],
  );

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
      patchConfig({ media: [...media, ...newRefs] });
    };
    input.click();
  }, [uploadFiles, media, patchConfig]);

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
      // 选素材库图片时替换整个 media（而不是追加），避免与已有本地导入图叠加
      patchConfig({ media: [ref] });
      setAssetDialogOpen(false);
    },
    [patchConfig],
  );

  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!current?.url) return;
      saveFreedomMedia(current.url, `blueprint-image-${Date.now()}.png`).catch(() => {
        // Download failed — user may have cancelled or network error
      });
    },
    [current],
  );

  return (
    <BoxShell
      id={id}
      nodeType="image-box"
      selected={selected}
      icon="🖼️"
      label={nodeData.label}
      execution={execution}
      width={320}
    >
      <NodeSection>
        {current?.url ? (
          <>
            <ImagePreview url={current.url} className="h-40 w-full" />
            <div className="mt-1 flex gap-1">
              <button
                className="nodrag flex-1 rounded border border-input bg-muted/40 px-1.5 py-1 text-[10px] text-foreground transition-colors hover:bg-muted"
                onClick={handleDownload}
              >
                ⬇ 下载
              </button>
              <button
                className="nodrag flex-1 rounded border border-input bg-muted/40 px-1.5 py-1 text-[10px] text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                onClick={handleUploadToLibrary}
                disabled={uploading}
              >
                {uploading ? '上传中...' : '⬆ 上传到素材库'}
              </button>
              <button
                className="nodrag flex-1 rounded border border-input bg-muted/40 px-1.5 py-1 text-[10px] text-foreground transition-colors hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  setAssetDialogOpen(true);
                }}
              >
                🗂 素材库
              </button>
            </div>
            {/* 生成/重新生成入口统一在 BoxConfigDrawer（点击窗口即弹出）。 */}
          </>
        ) : (
          <>
            <NodeDropZone
              label="拖入图片或点击选择"
              onFiles={handleFiles}
              accept="image/*"
              className="h-40"
            />
            <div className="mt-1 flex gap-1">
              <button
                className="nodrag flex-1 rounded border border-input bg-muted/40 px-1.5 py-1 text-[10px] text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                onClick={handleUploadToLibrary}
                disabled={uploading}
              >
                {uploading ? '上传中...' : '⬆ 上传到素材库'}
              </button>
              <button
                className="nodrag flex-1 rounded border border-input bg-muted/40 px-1.5 py-1 text-[10px] text-foreground transition-colors hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  setAssetDialogOpen(true);
                }}
              >
                🗂 素材库
              </button>
            </div>
          </>
        )}
      </NodeSection>

      <VolcAssetPanel
        open={assetDialogOpen}
        onOpenChange={setAssetDialogOpen}
        onSelectAsset={handleSelectAsset}
        selectedAssetIds={media.filter((m) => m.assetId).map((m) => m.assetId!)}
      />
    </BoxShell>
  );
}

/** Memoized image-box window. */
export const ImageBox = memo(ImageBoxComponent);
