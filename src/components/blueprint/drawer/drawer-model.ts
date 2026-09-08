// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL_LICENSE.md.
//
// drawer-model — 模型选择与控制区逻辑 for BoxConfigDrawer (§2.4 ③ / P2-7).
//
// 抽屉不另起参数体系：ModelSelector + GenParamControls 与自由页工作室
// 共用同一 model-registry / API 功能绑定。参数写入 config.generation
// （首次点击「生成」即落盘，窗口转为生成型），生成走蓝图执行器
// executeBlueprintRun('node', boxId)（保 DAG / 任务恢复 / 指标 / 去重）。

import type {
  BlueprintImageGeneratorConfig,
  BlueprintVideoGeneratorConfig,
  ImageBoxConfig,
  VideoBoxConfig,
} from '@/types/blueprint';

/** 抽屉内模型控制区的草稿状态（图片/视频共用形状，字段按需使用）。 */
export interface DrawerModelDraft {
  model: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  webSearch?: boolean;
  extraParams?: Record<string, unknown>;
}

/** 从 box config 读出草稿（generation 缺省时给空模型待选）。 */
export function readModelDraft(
  config: ImageBoxConfig | VideoBoxConfig,
): DrawerModelDraft {
  const gen = config.generation as
    | Partial<DrawerModelDraft & { referenceImageRefs?: unknown; referenceMediaRefs?: unknown }>
    | undefined;
  return {
    model: gen?.model ?? '',
    aspectRatio: gen?.aspectRatio,
    resolution: gen?.resolution,
    duration: gen?.duration,
    generateAudio: (gen as { generateAudio?: boolean } | undefined)?.generateAudio,
    watermark: (gen as { watermark?: boolean } | undefined)?.watermark,
    webSearch: (gen as { webSearch?: boolean } | undefined)?.webSearch,
    extraParams: gen?.extraParams as Record<string, unknown> | undefined,
  };
}

/** 把草稿合入 config（保留 prompt 与参考 refs 等执行所需字段）。 */
export function writeModelDraft(
  config: ImageBoxConfig | VideoBoxConfig,
  draft: DrawerModelDraft,
): ImageBoxConfig | VideoBoxConfig {
  const gen = (config.generation ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...gen };
  if (draft.model) next.model = draft.model;
  if (draft.aspectRatio !== undefined) next.aspectRatio = draft.aspectRatio;
  if (draft.resolution !== undefined) next.resolution = draft.resolution;
  if (draft.duration !== undefined) next.duration = draft.duration;
  if (draft.generateAudio !== undefined) next.generateAudio = draft.generateAudio;
  if (draft.watermark !== undefined) next.watermark = draft.watermark;
  if (draft.webSearch !== undefined) next.webSearch = draft.webSearch;
  if (draft.extraParams !== undefined) next.extraParams = draft.extraParams;
  return { ...config, generation: next } as ImageBoxConfig | VideoBoxConfig;
}

/** 付费任务确认回调：读蓝图灰度设置 allowPaidExecution。 */
export function makePaidTaskConfirm(): (nodes: unknown[]) => Promise<boolean> {
  return async (nodes) => {
    if (nodes.length === 0) return true;
    // 动态 import 避免测试环境拉起整个 settings persist。
    const { useAppSettingsStore } = await import('@/stores/app-settings-store');
    const allowed = useAppSettingsStore.getState().blueprintConfig.allowPaidExecution;
    if (!allowed) {
      const { toast } = await import('sonner');
      toast.error('已禁止执行付费生成任务（设置 → 蓝图灰度）');
      return false;
    }
    return true;
  };
}

export type { BlueprintImageGeneratorConfig, BlueprintVideoGeneratorConfig };
