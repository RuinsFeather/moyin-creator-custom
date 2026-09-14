// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 镜头语言标准化选项（景别 / 镜头运动）
 *
 * 集中管理，供编辑面板与 AI Prompt 共同引用，保证术语一致。
 * 每条含 value（写入数据）、label（含英文缩写）、description（悬停说明）。
 */

export interface ShotOption {
  value: string;
  label: string;
  description: string;
}

/** 景别选项（按取景范围从小到大） */
export const SHOT_SIZES: ShotOption[] = [
  { value: "极特写", label: "极特写 (ECU)", description: "眼睛、嘴唇等局部细节" },
  { value: "特写", label: "特写 (CU)", description: "面部、手部等关键部位" },
  { value: "近景", label: "近景 (MCU)", description: "胸部以上" },
  { value: "中近景", label: "中近景 (MS)", description: "腰部以上" },
  { value: "中景", label: "中景 (MFS)", description: "膝盖以上" },
  { value: "中远景", label: "中远景 (MLS)", description: "全身" },
  { value: "全景", label: "全景 (FS)", description: "全身+环境" },
  { value: "远景", label: "远景 (LS)", description: "人物占画面 1/4" },
  { value: "大远景", label: "大远景 (ELS)", description: "环境为主，人物渺小" },
];

/** 镜头运动选项 */
export const CAMERA_MOVEMENTS: ShotOption[] = [
  { value: "固定", label: "固定 (Static)", description: "机位不动" },
  { value: "推", label: "推 (Dolly In)", description: "向主体靠近" },
  { value: "拉", label: "拉 (Dolly Out)", description: "远离主体" },
  { value: "摇", label: "摇 (Pan)", description: "水平转动" },
  { value: "俯仰", label: "俯仰 (Tilt)", description: "垂直转动" },
  { value: "移", label: "移 (Trucking)", description: "水平移动" },
  { value: "跟", label: "跟 (Follow)", description: "跟随主体移动" },
  { value: "升降", label: "升降 (Crane)", description: "垂直升降" },
  { value: "环绕", label: "环绕 (Arc)", description: "围绕主体旋转" },
  { value: "手持", label: "手持 (Handheld)", description: "手持晃动效果" },
  { value: "斯坦尼康", label: "斯坦尼康 (Steadicam)", description: "稳定器跟拍" },
  { value: "无人机", label: "无人机 (Aerial)", description: "航拍视角" },
  { value: "变焦", label: "变焦 (Zoom)", description: "镜头焦距变化" },
  { value: "甩", label: "甩 (Whip Pan)", description: "快速甩镜转场" },
  { value: "主观", label: "主观 (POV)", description: "角色视角" },
];

/** 景别可选值列表（供 Prompt 内联） */
export const SHOT_SIZE_VALUES = SHOT_SIZES.map((o) => o.value);
/** 镜头运动可选值列表（供 Prompt 内联） */
export const CAMERA_MOVEMENT_VALUES = CAMERA_MOVEMENTS.map((o) => o.value);
