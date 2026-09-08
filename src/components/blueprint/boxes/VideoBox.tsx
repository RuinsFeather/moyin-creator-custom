// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// VideoBox — the "video-box" canvas window. §2.2 / P1-5.
//
// Content-first container: shows current video (import or generation result).
// No mode distinction — drag-in video imports, generation results write back.
// Download button via saveFreedomMedia (same as 自由 video studio).
// Full parameter configuration lives in BoxConfigDrawer (P2).

import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type {
  BlueprintNode,
  BlueprintNodeData,
  VideoBoxConfig,
} from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { saveFreedomMedia } from '@/lib/freedom/download-utils';
import { persistFilesAsRefs } from '@/lib/blueprint/blueprint-media';
import { NodeSection, NodeDropZone } from '../nodes/NodeUI';
import { VideoPreview } from './MediaPreview';
import { BoxShell } from './BoxShell';

function VideoBoxComponent({ id, data, selected }: NodeProps<BlueprintNode>) {
  const nodeData = data as BlueprintNodeData;
  const config = (nodeData.config ?? { media: [] }) as VideoBoxConfig;
  const execution = nodeData.execution;
  const updateNode = useBlueprintStore((s) => s.updateNode);

  const media = Array.isArray(config.media) ? config.media : [];
  // 显示优先级：执行结果（生成完成写入 execution.output）→ 手动导入的最后一项。
  // 旧实现只读 config.media，生成完成后窗口不更新。
  const execOutput = execution?.output;
  const outputRef = Array.isArray(execOutput)
    ? execOutput[execOutput.length - 1]
    : execOutput;
  const current = outputRef ?? media[media.length - 1];

  const patchConfig = useCallback(
    (patch: Partial<VideoBoxConfig>) => {
      updateNode(id, { config: { ...config, ...patch } });
    },
    [id, config, updateNode],
  );

  // 本地视频 → 持久化 local-image://（旧实现 blob: URL 重载后失效，
  // 且无法被上传链路识别，导致 "Invalid asset data"）。
  const handleFiles = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      void persistFilesAsRefs([file]).then(([newMedia]) => {
        if (!newMedia) return;
        patchConfig({ media: [newMedia] });
      });
    },
    [patchConfig],
  );

  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!current?.url) return;
      saveFreedomMedia(current.url, `blueprint-video-${Date.now()}.mp4`).catch(() => {
        // Download failed — user may have cancelled or network error
      });
    },
    [current],
  );

  return (
    <BoxShell
      id={id}
      nodeType="video-box"
      selected={selected}
      icon="🎬"
      label={nodeData.label}
      execution={execution}
      width={320}
    >
      <NodeSection>
        {current?.url ? (
          <>
            <VideoPreview url={current.url} className="h-40 w-full" />
            <div className="mt-1 flex gap-1">
              <button
                className="nodrag flex-1 rounded border border-input bg-muted/40 px-1.5 py-1 text-[10px] text-foreground transition-colors hover:bg-muted"
                onClick={handleDownload}
              >
                ⬇ 下载
              </button>
              <NodeDropZone
                label="+ 替换视频"
                onFiles={handleFiles}
                accept="video/*"
                multiple={false}
                className="min-h-0 py-1"
              />
            </div>
            {/* 生成/重新生成入口统一在 BoxConfigDrawer（点击窗口即弹出）。 */}
          </>
        ) : (
          <>
            <NodeDropZone
              label="拖入视频或点击选择"
              onFiles={handleFiles}
              accept="video/*"
              multiple={false}
              className="h-40"
            />
          </>
        )}
      </NodeSection>
    </BoxShell>
  );
}

/** Memoized video-box window. */
export const VideoBox = memo(VideoBoxComponent);
