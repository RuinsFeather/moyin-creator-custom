// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Script importer for storyboard (单剧本导入)
 *
 * 从当前项目导入一份代表当前单集、单场内容的剧本，生成稳定内容哈希以便
 * 检测剧本变更。一次只导入一份，不建立剧集/场次层级。
 */

/**
 * 计算剧本内容的稳定哈希（FNV-1a 32 位，拼接为 hex 字符串）。
 * 不依赖外部库，纯同步，适合作为 sourceScriptContentHash。
 */
export function hashScriptContent(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface ImportableScript {
  path: string; // 风对路径（工作区内）
  name: string;
  content: string;
  mtime?: number;
}

export interface ImportResolution {
  strategy: 'first-import' | 'update' | 'overwrite' | 'create-version';
}

/**
 * 从工作区文件列表筛选可导入的剧本文件。
 * markdown/script 类型文件均可作为剧本来源。
 */
export function pickImportableScripts(
  files: Array<{ path: string; name: string; content?: string; size?: number; mtime?: number; type?: string }>,
): ImportableScript[] {
  if (!Array.isArray(files)) return [];
  return files
    .filter((f) => (f.type === undefined || f.type === 'markdown' || f.type === 'script'))
    .map((f) => ({
      path: f.path,
      name: f.name,
      content: f.content || "",
      mtime: f.mtime,
    }))
    .filter((f) => f.content.trim().length > 0);
}

/**
 * 依据当前分镜文档与待导入剧本决定导入策略。
 */
export function resolveImportStrategy(
  currentScriptPath: string | undefined,
  currentHash: string | undefined,
  incomingPath: string,
  incomingHash: string,
): ImportResolution {
  if (!currentScriptPath || !currentHash) {
    return { strategy: 'first-import' };
  }
  if (currentScriptPath === incomingPath && currentHash === incomingHash) {
    return { strategy: 'update' };
  }
  if (currentScriptPath === incomingPath) {
    return { strategy: 'overwrite' };
  }
  return { strategy: 'create-version' };
}