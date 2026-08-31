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

contextBridge.exposeInMainWorld('scriptWorkspaceFs', {
  selectRoot: (): Promise<string | null> => ipcRenderer.invoke('script-workspace:select-root'),
  scan: (rootPath: string) => ipcRenderer.invoke('script-workspace:scan', rootPath),
  writeFile: (rootPath: string, relativePath: string, content: string) =>
    ipcRenderer.invoke('script-workspace:write-file', rootPath, relativePath, content),
  readFile: (rootPath: string, relativePath: string) =>
    ipcRenderer.invoke('script-workspace:read-file', rootPath, relativePath),
  createDirectory: (rootPath: string, relativePath: string) =>
    ipcRenderer.invoke('script-workspace:create-directory', rootPath, relativePath),
  remove: (rootPath: string, relativePath: string) =>
    ipcRenderer.invoke('script-workspace:delete', rootPath, relativePath),
  move: (rootPath: string, sourcePath: string, targetPath: string) =>
    ipcRenderer.invoke('script-workspace:move', rootPath, sourcePath, targetPath),
  copy: (rootPath: string, sourcePath: string, targetPath: string) =>
    ipcRenderer.invoke('script-workspace:copy', rootPath, sourcePath, targetPath),
  reveal: (rootPath: string, relativePath: string) =>
    ipcRenderer.invoke('script-workspace:reveal', rootPath, relativePath),
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
  openIntranetUpdateDir: (version?: string) =>
    ipcRenderer.invoke('app-updater-open-intranet-dir', version),
})

// 系统通知（视频生成成功等）：点击通知或按钮可将主窗口带到前台
contextBridge.exposeInMainWorld('appNotification', {
  show: (options: {
    title: string
    body?: string
    focusOnClick?: boolean
    silent?: boolean
    actionText?: string
  }) => ipcRenderer.invoke('notify-show', options),
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

// 火山引擎方舟素材资产上传（私域虚拟人像 AK/SK 鉴权）
contextBridge.exposeInMainWorld('volcAsset', {
  saveConfig: (cfg: { accessKeyId: string; secretAccessKey: string; projectName?: string }) =>
    ipcRenderer.invoke('volc-asset:save-config', cfg),
  getConfig: () => ipcRenderer.invoke('volc-asset:get-config'),
  isConfigured: (): Promise<boolean> => ipcRenderer.invoke('volc-asset:is-configured'),
  createGroup: (payload: { name: string; description?: string; projectName?: string }) =>
    ipcRenderer.invoke('volc-asset:create-group', payload),
  createAsset: (payload: { groupId: string; imageUrl: string; name?: string; projectName?: string }) =>
    ipcRenderer.invoke('volc-asset:create-asset', payload),
  getStatus: (payload: { assetId: string; projectName?: string }) =>
    ipcRenderer.invoke('volc-asset:get-status', payload),
  uploadFull: (payload: {
    imageUrl: string
    groupName: string
    groupDescription?: string
    assetName?: string
    existingGroupId?: string
    projectName?: string
  }) => ipcRenderer.invoke('volc-asset:upload-full', payload),
  batchUpload: (payload: {
    imageUrls: string[]
    groupName: string
    groupDescription?: string
    existingGroupId?: string
    projectName?: string
  }) => ipcRenderer.invoke('volc-asset:batch-upload', payload),
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
  /**
   * 流式 fetch（SSE）：invoke 返回响应头信息，响应体 chunk 通过
   * channel（`net:proxy-stream:<id>`）事件逐块推送。
   * 返回的 Response body 是一个实时 ReadableStream。
   */
  fetchStream: (req: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    bodyIsBase64?: boolean
    timeoutMs?: number
  }) => ipcRenderer.invoke('net:proxy-fetch-stream', {
    ...req,
    channel: `net:proxy-stream:${streamSeq++}`,
  }),
})

/** 流式请求的事件通道序号（保证每次调用 channel 唯一） */
let streamSeq = 0

/** 监听流式代理事件。返回取消监听函数。 */
contextBridge.exposeInMainWorld('netProxyStream', {
  on: (channel: string, cb: (event: { type: 'chunk' | 'done' | 'error'; text?: string; message?: string }) => void) => {
    const listener = (_e: unknown, data: { type: 'chunk' | 'done' | 'error'; text?: string; message?: string }) => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})

