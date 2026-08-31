// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard file service (工作区文件保存/读取)
 *
 * 将分镜文档写入资源管理器当前打开的工作区文件夹：
 *   storyboard.json  —— 权威结构化数据（蓝图消费）
 *   storyboard.md    —— 可选，便于人工查看
 *
 * 参考图只保存稳定 assetId 或 local-image:// 引用，不保存临时 Base64。
 *
 * 同时支持从工作区 storyboard.json 重新打开分镜文档（loadStoryboardFromWorkspace）。
 */
import { getScriptWorkspaceFs } from "@/lib/script-workspace-fs";
import { useScriptWorkspaceStore } from "@/stores/script-workspace-store";
import type {
  StoryboardDocument,
  StoryboardReferences,
  StoryboardReferenceImage,
  StoryboardShot,
  StoryboardShotContent,
} from "@/types/storyboard";

export const STORYBOARD_JSON_FILE = "storyboard.json";
export const STORYBOARD_MD_FILE = "storyboard.md";
/** 上传的 Base64 参考图落盘目录（工作区相对路径） */
export const STORYBOARD_REFS_DIR = "storyboard-refs";

/** data URL -> 文件扩展名（按 MIME 推断，默认 .png） */
export function dataUrlExt(dataUrl: string): string {
  const m = /^data:image\/(png|jpe?g|webp|gif);/i.exec(dataUrl);
  switch (m?.[1]?.toLowerCase()) {
    case "png": return ".png";
    case "jpeg":
    case "jpg": return ".jpg";
    case "webp": return ".webp";
    case "gif": return ".gif";
    default: return ".png";
  }
}

/** 该参考图是否为工作区内稳定引用（local-image:// 或已是 assetId） */
export function isStableReferenceUrl(url: string | undefined): boolean {
  if (!url) return false;
  return !url.startsWith("data:");
}

/**
 * 将文档中 upload 类型的 Base64 参考图固化到工作区，
 * 并把引用替换为 stable local-image:// URL（§14 风险：参考图失效）。
 * 只处理 sourceType === "upload" 且 localUrl 为 data: 的图片；已稳定引用跳过。
 *
 * @returns 更新后的文档（复制，不修改入参）。
 */
export async function persistReferenceImagesToWorkspace(
  doc: StoryboardDocument,
): Promise<StoryboardDocument> {
  const fs = getScriptWorkspaceFs();
  const root = useScriptWorkspaceStore.getState().workspaceRoot;
  if (!fs || !root) return doc; // 无工作区时保持原样，不抛错（保存主流程自行判断）

  // 找出需要固化的图片
  const pending: Array<{ shotId: string; imageId: string; url: string }> = [];
  for (const shot of doc.shots) {
    for (const img of shot.referenceImages) {
      if (img.sourceType === "upload" && !isStableReferenceUrl(img.localUrl)) {
        pending.push({ shotId: shot.id, imageId: img.id, url: img.localUrl! });
      }
    }
  }
  if (pending.length === 0) return doc;

  // 确保目录存在
  try {
    await fs.createDirectory(root, STORYBOARD_REFS_DIR);
  } catch {
    // 已存在目录时报错可忽略
  }

  const updated = {
    ...doc,
    shots: doc.shots.map((shot) => ({
      ...shot,
      referenceImages: shot.referenceImages.map((img) => ({ ...img })),
    })),
  };
  for (const item of pending) {
    const ext = dataUrlExt(item.url);
    const relPath = `${STORYBOARD_REFS_DIR}/${item.shotId}-${item.imageId}${ext}`;
    const [, base64] = item.url.split(",");
    if (!base64) continue;
    try {
      await fs.writeFile(root, relPath, base64);
    } catch {
      continue; // 单张失败不阻塞整个保存
    }
    const shot = updated.shots.find((s) => s.id === item.shotId);
    const img = shot?.referenceImages.find((i) => i.id === item.imageId);
    if (img) {
      img.localUrl = `local-image://${relPath}`;
      img.thumbnailUrl = `local-image://${relPath}`;
    }
  }

  return updated;
}

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
 *
 * 保存前会把 upload 类型的 Base64 参考图固化到 storyboard-refs/ 目录，
 * 并以稳定 local-image:// 引用替换（§14 风险：参考图失效）。
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

  // 固化 Base64 参考图为稳定引用
  const savedDoc = await persistReferenceImagesToWorkspace(doc);

  const json = JSON.stringify(savedDoc, null, 2);
  await fs.writeFile(root, STORYBOARD_JSON_FILE, json);

  const result: { jsonPath: string; mdPath?: string } = {
    jsonPath: STORYBOARD_JSON_FILE,
  };
  if (options.includeMarkdown) {
    const md = renderStoryboardMarkdown(savedDoc);
    await fs.writeFile(root, STORYBOARD_MD_FILE, md);
    result.mdPath = STORYBOARD_MD_FILE;
  }
  return result;
}

// ==================== 工作区加载 ====================

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() || `sb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeShotContent(raw: Partial<StoryboardShotContent> | undefined): StoryboardShotContent {
  return {
    summary: typeof raw?.summary === "string" ? raw.summary : "",
    scene: typeof raw?.scene === "string" ? raw.scene : "",
    action: typeof raw?.action === "string" ? raw.action : "",
    dialogue: typeof raw?.dialogue === "string" ? raw.dialogue : "",
    shotSize: typeof raw?.shotSize === "string" ? raw.shotSize : "",
    cameraMovement: typeof raw?.cameraMovement === "string" ? raw.cameraMovement : "",
    durationSeconds: typeof raw?.durationSeconds === "number" ? raw.durationSeconds : undefined,
    additionalDescription:
      typeof raw?.additionalDescription === "string" ? raw.additionalDescription : undefined,
  };
}

function normalizeReferences(raw: Partial<StoryboardReferences> | undefined): StoryboardReferences {
  const refs = (raw || {}) as Partial<StoryboardReferences>;
  return {
    characters: Array.isArray(refs.characters) ? refs.characters : [],
    costumes: Array.isArray(refs.costumes) ? refs.costumes : [],
    scenes: Array.isArray(refs.scenes) ? refs.scenes : [],
  };
}

function normalizeReferenceImages(
  raw: Array<Partial<StoryboardReferenceImage>> | undefined,
): StoryboardReferenceImage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((img) => img && typeof img === "object")
    .map((img) => ({
      id: typeof img.id === "string" && img.id ? img.id : makeId(),
      sourceType: img.sourceType || "upload",
      assetId: typeof img.assetId === "string" ? img.assetId : undefined,
      relatedReferenceId:
        typeof img.relatedReferenceId === "string" ? img.relatedReferenceId : undefined,
      localUrl: typeof img.localUrl === "string" ? img.localUrl : undefined,
      thumbnailUrl: typeof img.thumbnailUrl === "string" ? img.thumbnailUrl : undefined,
      label: typeof img.label === "string" ? img.label : undefined,
    }));
}

/**
 * 将解析出的原始 JSON 归一化为合法的 StoryboardDocument。
 * 兼容缺省字段：补默认值、重建 shots 顺序索引、丢弃非法镜头。
 * 若根本不是一个分镜文档（缺 shots 数组 / 缺 id），返回 null。
 * 导出以便测试。
 */
export function normalizeStoryboardDocument(raw: unknown): StoryboardDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  if (!Array.isArray(r.shots) || typeof r.id !== "string") return null;

  const now = Date.now();
  const shots: StoryboardShot[] = [];
  for (const s of r.shots) {
    if (!s || typeof s !== "object") continue;
    const shot = s as Record<string, unknown>;
    const content = normalizeShotContent(shot.content as Partial<StoryboardShotContent> | undefined);
    const shotId = typeof shot.id === "string" && shot.id ? shot.id : makeId();
    const shotNow = typeof shot.createdAt === "number" ? shot.createdAt : now;
    shots.push({
      id: shotId,
      sourceText: typeof shot.sourceText === "string" ? shot.sourceText : undefined,
      sourceTextRange:
        shot.sourceTextRange && typeof shot.sourceTextRange === "object"
          ? (shot.sourceTextRange as { start: number; end: number })
          : undefined,
      order: -1, // 下面重建
      shotNumber: "", // 下面重建
      content,
      references: normalizeReferences(shot.references as Partial<StoryboardReferences> | undefined),
      notes: typeof shot.notes === "string" ? shot.notes : "",
      referenceImages: normalizeReferenceImages(
        shot.referenceImages as Array<Partial<StoryboardReferenceImage>> | undefined,
      ),
      origin: shot.origin === "ai" || shot.origin === "imported" ? shot.origin : "manual",
      reviewStatus:
        shot.reviewStatus === "confirmed" || shot.reviewStatus === "modified"
          ? shot.reviewStatus
          : "pending",
      createdAt: shotNow,
      updatedAt: typeof shot.updatedAt === "number" ? shot.updatedAt : shotNow,
    });
  }

  // 重建顺序索引（不信任文件里的 order/shotNumber，避免乱序脏数据）
  shots.forEach((shot, i) => {
    shot.order = i;
    shot.shotNumber = String(i + 1);
  });

  return {
    id: r.id,
    projectId: typeof r.projectId === "string" ? r.projectId : "unknown",
    title: typeof r.title === "string" && r.title ? r.title : "未命名分镜",
    sourceScriptPath: typeof r.sourceScriptPath === "string" ? r.sourceScriptPath : "",
    sourceScriptRevision: typeof r.sourceScriptRevision === "string" ? r.sourceScriptRevision : undefined,
    sourceScriptContentHash:
      typeof r.sourceScriptContentHash === "string" ? r.sourceScriptContentHash : undefined,
    version: typeof r.version === "number" && r.version >= 1 ? r.version : 1,
    status:
      r.status === "analyzing" || r.status === "review" || r.status === "confirmed"
        ? r.status
        : "draft",
    shots,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : now,
  };
}

/**
 * 从当前工作区打开已保存的 storyboard.json。
 * 会校验文件存在、JSON 合法，并归一化出合法 StoryboardDocument。
 *
 * @returns 归一化后的分镜文档；若文件不存在或不是合法分镜 JSON 则返回 null。
 * 若工作区 FS 不可用 / 未选根目录则抛错。
 */
export async function loadStoryboardFromWorkspace(): Promise<StoryboardDocument | null> {
  const fs = getScriptWorkspaceFs();
  if (!fs) {
    throw new Error("工作区文件系统不可用，请先通过「剧本」模块打开工作区文件夹");
  }
  const root = useScriptWorkspaceStore.getState().workspaceRoot;
  if (!root) {
    throw new Error("尚未选择工作区根目录");
  }

  let content: string;
  try {
    content = await fs.readFile(root, STORYBOARD_JSON_FILE);
  } catch {
    return null; // 文件不存在 → 无已保存分镜
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`分镜文件解析失败：${(e as Error).message || "JSON 格式错误"}`);
  }

  return normalizeStoryboardDocument(parsed);
}