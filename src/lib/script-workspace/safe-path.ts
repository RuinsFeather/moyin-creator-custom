// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL_LICENSE.md.

/**
 * 工作区相对路径安全校验（Agent CREATE 协议 / 资源管理器共用）
 *
 * 规则与 ProjectExplorer 的手动新建一致：
 * - 非空、不以 / 开头、无 \0、无 . / .. 段、无反斜杠
 * - 文件名后缀必须在编辑器白名单内（.md / .txt / .markdown）
 */

/** 可编辑文件后缀白名单（与 ProjectExplorer.ALLOWED_EXTENSIONS 一致） */
export const EDITABLE_FILE_EXTENSIONS = new Set(['.md', '.txt', '.markdown']);

/** 判断是否为安全的工作区相对路径（不含后缀约束） */
export function isSafeRelativePath(path: string): boolean {
  return Boolean(path)
    && !path.startsWith('/')
    && !path.includes('\0')
    && !path.includes('\\')
    && path.split('/').every((part) => part && part !== '.' && part !== '..');
}

/** 判断文件名后缀是否可编辑（.md / .txt / .markdown） */
export function hasEditableExtension(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot >= 0 && EDITABLE_FILE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * CREATE 协议路径校验：安全相对路径 + 可编辑后缀。
 * 返回 null 表示合法；否则返回给模型/用户的中文错误原因。
 */
export function validateCreatePath(path: string): string | null {
  if (!path.trim()) return '路径为空';
  if (!isSafeRelativePath(path)) return '路径不安全（不允许绝对路径、.. 或反斜杠）';
  if (!hasEditableExtension(path)) return '后缀必须是 .md / .txt / .markdown 之一';
  return null;
}
