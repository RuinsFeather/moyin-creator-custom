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

export type ScriptWorkspaceFs = Omit<NonNullable<Window['scriptWorkspaceFs']>, 'writeImage' | 'readImage' | 'writeBinary' | 'readBinary' | 'copyExternalFile'> & {
  writeImage?: (rootPath: string, relativePath: string, base64Data: string) => Promise<{ mtime: number; size: number }>;
  readImage?: (rootPath: string, relativePath: string) => Promise<string>;
  writeBinary?: (rootPath: string, relativePath: string, base64Data: string) => Promise<{ mtime: number; size: number }>;
  readBinary?: (rootPath: string, relativePath: string, mimeType?: string) => Promise<string>;
  copyExternalFile?: (sourcePath: string, rootPath: string, relativePath: string) => Promise<{ mtime: number; size: number }>;
};

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
    writeImage: (rootPath, relativePath, base64Data) =>
      ipc.invoke('script-workspace:write-image', rootPath, relativePath, base64Data) as Promise<{ mtime: number; size: number }>,
    writeBinary: (rootPath, relativePath, base64Data) =>
      ipc.invoke('script-workspace:write-binary', rootPath, relativePath, base64Data) as Promise<{ mtime: number; size: number }>,
    readBinary: (rootPath, relativePath, mimeType) =>
      ipc.invoke('script-workspace:read-binary', rootPath, relativePath, mimeType) as Promise<string>,
    copyExternalFile: (sourcePath, rootPath, relativePath) =>
      ipc.invoke('script-workspace:copy-external-file', sourcePath, rootPath, relativePath) as Promise<{ mtime: number; size: number }>,
    readImage: (rootPath, relativePath) =>
      ipc.invoke('script-workspace:read-image', rootPath, relativePath) as Promise<string>,
  };
}

export function isElectronRenderer(): boolean {
  return Boolean(window.scriptWorkspaceFs || window.ipcRenderer);
}