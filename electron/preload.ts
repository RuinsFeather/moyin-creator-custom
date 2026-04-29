// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { ipcRenderer, contextBridge, webUtils } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

// Image storage API
contextBridge.exposeInMainWorld('imageStorage', {
  // Save image from URL to local storage
  saveImage: (url: string, category: string, filename: string) => 
    ipcRenderer.invoke('save-image', { url, category, filename }),
  
  // Get actual file path for a local-image:// URL
  getImagePath: (localPath: string) => 
    ipcRenderer.invoke('get-image-path', localPath),
  
  // Delete a locally stored image
  deleteImage: (localPath: string) => 
    ipcRenderer.invoke('delete-image', localPath),
  
  // Read local image as base64 (for AI API calls like video generation)
  readAsBase64: (localPath: string) => 
    ipcRenderer.invoke('read-image-base64', localPath),
  
  // Get absolute file path (for local video generation tools like FFmpeg)
  getAbsolutePath: (localPath: string) => 
    ipcRenderer.invoke('get-absolute-path', localPath),
})

// File storage API for app data (unlimited size)
contextBridge.exposeInMainWorld('fileStorage', {
  getItem: (key: string) => ipcRenderer.invoke('file-storage-get', key),
  setItem: (key: string, value: string) => ipcRenderer.invoke('file-storage-set', key, value),
  removeItem: (key: string) => ipcRenderer.invoke('file-storage-remove', key),
  exists: (key: string) => ipcRenderer.invoke('file-storage-exists', key),
  listKeys: (prefix: string) => ipcRenderer.invoke('file-storage-list', prefix),
  listDirs: (prefix: string) => ipcRenderer.invoke('file-storage-list-dirs', prefix),
  removeDir: (prefix: string) => ipcRenderer.invoke('file-storage-remove-dir', prefix),
})
// Storage manager API for paths, cache, import/export
contextBridge.exposeInMainWorld('storageManager', {
  getPaths: () => ipcRenderer.invoke('storage-get-paths'),
  selectDirectory: () => ipcRenderer.invoke('storage-select-directory'),
  // Unified storage operations (single base path)
  validateDataDir: (dirPath: string) => ipcRenderer.invoke('storage-validate-data-dir', dirPath),
  moveData: (newPath: string) => ipcRenderer.invoke('storage-move-data', newPath),
  linkData: (dirPath: string) => ipcRenderer.invoke('storage-link-data', dirPath),
  exportData: (targetPath: string) => ipcRenderer.invoke('storage-export-data', targetPath),
  importData: (sourcePath: string) => ipcRenderer.invoke('storage-import-data', sourcePath),
  // Cache
  getCacheSize: () => ipcRenderer.invoke('storage-get-cache-size'),
  clearCache: (options?: { olderThanDays?: number }) => ipcRenderer.invoke('storage-clear-cache', options),
  updateConfig: (config: { autoCleanEnabled?: boolean; autoCleanDays?: number }) =>
    ipcRenderer.invoke('storage-update-config', config),
})

// Electron API for native features
contextBridge.exposeInMainWorld('electronAPI', {
  saveFileDialog: (options: { localPath: string, defaultPath: string, filters: { name: string, extensions: string[] }[] }) =>
    ipcRenderer.invoke('save-file-dialog', options),
})

contextBridge.exposeInMainWorld('appUpdater', {
  getCurrentVersion: () => ipcRenderer.invoke('app-updater-get-current-version'),
  checkForUpdates: () => ipcRenderer.invoke('app-updater-check'),
  openExternalLink: (url: string) => ipcRenderer.invoke('app-updater-open-link', url),
})

contextBridge.exposeInMainWorld('imageHostUploader', {
  upload: (payload: {
    provider: {
      name: string
      platform: string
      baseUrl?: string
      uploadPath?: string
      apiKeyParam?: string
      apiKeyHeader?: string
      apiKeyFormField?: string
      expirationParam?: string
      imageField?: string
      imagePayloadType?: 'base64' | 'file'
      nameField?: string
      staticFormFields?: Record<string, string>
      responseUrlField?: string
      responseDeleteUrlField?: string
    }
    apiKey: string
    imageData: string
    options?: {
      name?: string
      expiration?: number
    }
  }) => ipcRenderer.invoke('image-host-upload', payload),
})

// 对象存储（S3 兼容）：用于视频/音频等大文件上传
// 流程：渲染端拿到本地 File → 通过 webUtils.getPathForFile(file) 取出绝对路径
//       → 调用 upload(filePath) → 主进程流式上传 → 返回 HTTP URL
contextBridge.exposeInMainWorld('objectStorage', {
  /** 从 File 对象提取本地绝对路径（拖拽 / file input 来源） */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  isConfigured: (): Promise<boolean> => ipcRenderer.invoke('object-storage:is-configured'),
  getConfig: () => ipcRenderer.invoke('object-storage:get-config'),
  saveConfig: (cfg: {
    endpoint: string
    region: string
    bucket: string
    accessKeyId: string
    secretAccessKey: string
    publicBase?: string
    forcePathStyle?: boolean
    presignExpires?: number
  }) => ipcRenderer.invoke('object-storage:save-config', cfg),
  test: (cfg?: any) => ipcRenderer.invoke('object-storage:test', cfg),
  upload: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('object-storage:upload', filePath),
  /** 监听上传进度。返回取消监听函数 */
  onProgress: (cb: (data: { filePath: string; loaded: number; total: number }) => void) => {
    const listener = (_e: unknown, data: { filePath: string; loaded: number; total: number }) => cb(data)
    ipcRenderer.on('object-storage:progress', listener)
    return () => ipcRenderer.removeListener('object-storage:progress', listener)
  },
  /** 获取存储用量统计 */
  getUsage: () => ipcRenderer.invoke('object-storage:get-usage'),
  /** 触发清理：retentionDays=0 配合 deleteAll=true 清空 */
  cleanup: (opts?: { retentionDays?: number; deleteAll?: boolean }) =>
    ipcRenderer.invoke('object-storage:cleanup', opts),
})

// 通用网络代理：让渲染进程通过主进程发起请求，绕过 Chromium CORS 限制
// 用于直连第三方 API（如 ark.cn-beijing.volces.com 火山方舟原生域）
contextBridge.exposeInMainWorld('netProxy', {
  fetch: (req: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    bodyIsBase64?: boolean
    timeoutMs?: number
  }) => ipcRenderer.invoke('net:proxy-fetch', req),
})

