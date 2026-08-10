// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard file service (工作区文件保存)
 *
 * 将分镜文档写入资源管理器当前打开的工作区文件夹：
 *   storyboard.json  —— 权威结构化数据（蓝图消费）
 *   storyboard.md    —— 可选，便于人工查看
 *
 * 参考图只保存稳定 assetId 或 local-image:// 引用，不保存临时 Base64。
 */
import { getScriptWorkspaceFs } from "@/lib/script-workspace-fs";
import { useScriptWorkspaceStore } from "@/stores/script-workspace-store";
import type { StoryboardDocument } from "@/types/storyboard";

export const STORYBOARD_JSON_FILE = "storyboard.json";
export const STORYBOARD_MD_FILE = "storyboard.md";

/**
 * 是否有可用的工作区 FS（Electron 环境）。
 */
export function canWriteWorkspaceFile(): boolean {
  return getScriptWorkspaceFs() !== null;
}

/**
 * 将分镜文档渲染为便于人工查看的 Markdown 文本。
 */
export function renderStoryboardMarkdown(doc: StoryboardDocument): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title || "分镜表"}`);
  lines.push("");
  lines.push(`- 版本：v${doc.version}`);
  lines.push(`- 状态：${doc.status}`);
  lines.push(`- 来源剧本：${doc.sourceScriptPath || "—"}`);
  if (doc.sourceScriptContentHash) {
    lines.push(`- 剧本哈希：${doc.sourceScriptContentHash}`);
  }
  lines.push(`- 更新时间：${new Date(doc.updatedAt).toLocaleString()}`);
  lines.push("");
  lines.push(`| 镜号 | 画面内容 | 场景 | 动作 | 对白 | 景别 | 时长(s) | 镜头运动 | 备注 |`);
  lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const shot of doc.shots) {
    const c = shot.content;
    const dur = c.durationSeconds ?? "";
    const summary = (c.summary || "").replace(/\n/g, " ");
    const scene = (c.scene || "").replace(/\n/g, " ");
    const action = (c.action || "").replace(/\n/g, " ");
    const dialogue = (c.dialogue || "").replace(/\n/g, " ");
    const notes = (shot.notes || "").replace(/\n/g, " ");
    lines.push(
      `| ${shot.shotNumber} | ${summary} | ${scene} | ${action} | ${dialogue} | ${c.shotSize} | ${dur} | ${c.cameraMovement} | ${notes} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * 保存分镜文档到当前工作区。返回实际写入的两个路径。
 * 若工作区 FS 不可用则抛出错误。
 */
export async function saveStoryboardToWorkspace(
  doc: StoryboardDocument,
  options: { includeMarkdown?: boolean } = {},
): Promise<{ jsonPath: string; mdPath?: string }> {
  const fs = getScriptWorkspaceFs();
  if (!fs) {
    throw new Error("工作区文件系统不可用，请先通过「剧本」模块打开工作区文件夹");
  }
  const root = useScriptWorkspaceStore.getState().workspaceRoot;
  if (!root) {
    throw new Error("尚未选择工作区根目录");
  }

  const json = JSON.stringify(doc, null, 2);
  await fs.writeFile(root, STORYBOARD_JSON_FILE, json);

  const result: { jsonPath: string; mdPath?: string } = {
    jsonPath: STORYBOARD_JSON_FILE,
  };
  if (options.includeMarkdown) {
    const md = renderStoryboardMarkdown(doc);
    await fs.writeFile(root, STORYBOARD_MD_FILE, md);
    result.mdPath = STORYBOARD_MD_FILE;
  }
  return result;
}