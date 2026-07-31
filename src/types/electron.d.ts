// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import type { OpenExternalResult, UpdateCheckResult } from "./update";

export {};

declare global {
  interface Window {
    ipcRenderer?: {
      on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
      off: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
      send: (channel: string, ...args: unknown[]) => void;
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
    imageStorage?: {
      saveImage: (url: string, category: string, filename: string) => Promise<{ success: boolean; localPath?: string; error?: string }>;
      getImagePath: (localPath: string) => Promise<string | null>;
      deleteImage: (localPath: string) => Promise<boolean>;
      readAsBase64: (localPath: string) => Promise<string | null>;
      getAbsolutePath: (localPath: string) => Promise<string | null>;
    };
    fileStorage?: {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<boolean>;
      removeItem: (key: string) => Promise<boolean>;
      exists: (key: string) => Promise<boolean>;
      listKeys: (prefix: string) => Promise<string[]>;
      listDirs: (prefix: string) => Promise<string[]>;
      removeDir: (prefix: string) => Promise<boolean>;
    };
    storageManager?: {
      getPaths: () => Promise<{ basePath: string; projectPath: string; mediaPath: string; cachePath: string }>;
      selectDirectory: () => Promise<string | null>;
      // Unified storage operations (single base path for projects + media)
      validateDataDir: (dirPath: string) => Promise<{ valid: boolean; projectCount?: number; mediaCount?: number; error?: string }>;
      moveData: (newPath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      linkData: (dirPath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      exportData: (targetPath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      importData: (sourcePath: string) => Promise<{ success: boolean; error?: string }>;
      // Cache
      getCacheSize: () => Promise<{ total: number; details: Array<{ path: string; size: number }> }>;
      clearCache: (options?: { olderThanDays?: number }) => Promise<{ success: boolean; clearedBytes?: number; error?: string }>;
      updateConfig: (config: { autoCleanEnabled?: boolean; autoCleanDays?: number }) => Promise<boolean>;
    };
    electronAPI?: {
      saveFileDialog: (options: {
        localPath: string;
        defaultPath: string;
        filters: { name: string; extensions: string[] }[];
      }) => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
    };
    appUpdater?: {
      getCurrentVersion: () => Promise<string>;
      checkForUpdates: () => Promise<UpdateCheckResult>;
      openExternalLink: (url: string) => Promise<OpenExternalResult>;
      /** 打开公司内网共享盘中对应版本号的安装包目录 */
      openIntranetUpdateDir?: (version?: string) => Promise<OpenExternalResult>;
    };
    appNotification?: {
      show: (options: {
        title: string;
        body?: string;
        /** 点击通知/按钮时是否将主窗口带到前台，默认 true */
        focusOnClick?: boolean;
        silent?: boolean;
        /** 通知上的按钮文案（如「打开软件」） */
        actionText?: string;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    imageHostUploader?: {
      upload: (payload: {
        provider: {
          name: string;
          platform: string;
          baseUrl?: string;
          uploadPath?: string;
          apiKeyParam?: string;
          apiKeyHeader?: string;
          apiKeyFormField?: string;
          expirationParam?: string;
          imageField?: string;
          imagePayloadType?: 'base64' | 'file';
          nameField?: string;
          staticFormFields?: Record<string, string>;
          responseUrlField?: string;
          responseDeleteUrlField?: string;
        };
        apiKey: string;
        imageData: string;
        options?: {
          name?: string;
          expiration?: number;
        };
      }) => Promise<{
        success: boolean;
        url?: string;
        deleteUrl?: string;
        error?: string;
      }>;
    };
    objectStorage?: {
      getPathForFile: (file: File) => string;
      isConfigured: () => Promise<boolean>;
      getConfig: () => Promise<{
        endpoint: string;
        region: string;
        bucket: string;
        accessKeyId: string;
        secretAccessKey: string;
        publicBase?: string;
        forcePathStyle?: boolean;
        presignExpires?: number;
        autoCleanEnabled?: boolean;
        retentionDays?: number;
        maxStorageBytes?: number;
        encrypted?: boolean;
      } | null>;
      saveConfig: (cfg: {
        endpoint: string;
        region: string;
        bucket: string;
        accessKeyId: string;
        secretAccessKey: string;
        publicBase?: string;
        forcePathStyle?: boolean;
        presignExpires?: number;
        autoCleanEnabled?: boolean;
        retentionDays?: number;
        maxStorageBytes?: number;
      }) => Promise<{ ok: true }>;
      test: (cfg?: {
        endpoint: string;
        region: string;
        bucket: string;
        accessKeyId: string;
        secretAccessKey: string;
        forcePathStyle?: boolean;
      }) => Promise<{ ok: true }>;
      upload: (filePath: string) => Promise<string>;
      onProgress: (
        cb: (data: { filePath: string; loaded: number; total: number }) => void,
      ) => () => void;
      getUsage: () => Promise<{
        totalBytes: number;
        totalCount: number;
        oldest: number | null;
        newest: number | null;
        maxStorageBytes: number;
        retentionDays: number;
        autoCleanEnabled: boolean;
      }>;
      cleanup: (opts?: { retentionDays?: number; deleteAll?: boolean }) => Promise<{
        deletedCount: number;
        deletedBytes: number;
        remainingCount: number;
        remainingBytes: number;
      }>;
    };
    volcAsset?: {
      saveConfig: (cfg: {
        accessKeyId: string;
        secretAccessKey: string;
        projectName?: string;
      }) => Promise<{ ok: true }>;
      getConfig: () => Promise<{
        accessKeyId: string;
        secretAccessKey: string;
        projectName: string;
      } | null>;
      isConfigured: () => Promise<boolean>;
      createGroup: (payload: {
        name: string;
        description?: string;
        projectName?: string;
      }) => Promise<{ groupId: string; name: string }>;
      createAsset: (payload: {
        groupId: string;
        imageUrl: string;
        name?: string;
        projectName?: string;
      }) => Promise<{ assetId: string }>;
      getStatus: (payload: {
        assetId: string;
        projectName?: string;
      }) => Promise<{
        id: string;
        status: 'Processing' | 'Active' | 'Failed';
        url?: string;
        error?: string;
      }>;
      uploadFull: (payload: {
        imageUrl: string;
        groupName: string;
        groupDescription?: string;
        assetName?: string;
        existingGroupId?: string;
        projectName?: string;
      }) => Promise<{
        assetId: string;
        assetUri: string;
        url: string;
        groupId: string;
      }>;
      batchUpload: (payload: {
        imageUrls: string[];
        groupName: string;
        groupDescription?: string;
        existingGroupId?: string;
        projectName?: string;
      }) => Promise<{
        groupId: string;
        results: Array<{
          imageUrl: string;
          assetId?: string;
          assetUri?: string;
          url?: string;
          error?: string;
        }>;
      }>;
    };
    netProxy?: {
      fetch: (req: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        bodyIsBase64?: boolean;
        timeoutMs?: number;
      }) => Promise<{
        ok: boolean;
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: string;
      }>;
    };
  }
}
