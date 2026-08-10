// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

export type ScriptWorkspaceResource = {
  name: string;
  relativePath: string;
  kind: 'file' | 'directory';
  editable: boolean;
  size?: number;
  mtime?: number;
  content?: string;
};

export type ScriptWorkspaceFs = NonNullable<Window['scriptWorkspaceFs']>;

/**
 * Resolve the script workspace filesystem bridge.
 *
 * Packaged builds use the dedicated preload facade. During Electron dev/HMR,
 * an already-open renderer can temporarily retain an older preload context;
 * the generic IPC facade provides a compatible fallback until the next full
 * window restart.
 */
export function getScriptWorkspaceFs(): ScriptWorkspaceFs | null {
  if (window.scriptWorkspaceFs) return window.scriptWorkspaceFs;
  const ipc = window.ipcRenderer;
  if (!ipc) return null;

  return {
    selectRoot: () => ipc.invoke('script-workspace:select-root') as Promise<string | null>,
    scan: (rootPath) => ipc.invoke('script-workspace:scan', rootPath) as Promise<ScriptWorkspaceResource[]>,
    writeFile: (rootPath, relativePath, content) =>
      ipc.invoke('script-workspace:write-file', rootPath, relativePath, content) as Promise<{ mtime: number; size: number }>,
    readFile: (rootPath, relativePath) =>
      ipc.invoke('script-workspace:read-file', rootPath, relativePath) as Promise<string>,
    createDirectory: (rootPath, relativePath) =>
      ipc.invoke('script-workspace:create-directory', rootPath, relativePath) as Promise<boolean>,
    remove: (rootPath, relativePath) =>
      ipc.invoke('script-workspace:delete', rootPath, relativePath) as Promise<boolean>,
    move: (rootPath, sourcePath, targetPath) =>
      ipc.invoke('script-workspace:move', rootPath, sourcePath, targetPath) as Promise<boolean>,
    copy: (rootPath, sourcePath, targetPath) =>
      ipc.invoke('script-workspace:copy', rootPath, sourcePath, targetPath) as Promise<boolean>,
    reveal: (rootPath, relativePath) =>
      ipc.invoke('script-workspace:reveal', rootPath, relativePath) as Promise<boolean>,
  };
}

export function isElectronRenderer(): boolean {
  return Boolean(window.scriptWorkspaceFs || window.ipcRenderer);
}