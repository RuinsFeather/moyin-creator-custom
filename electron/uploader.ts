// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
//
// 主进程对象存储上传模块（S3 兼容协议）
// 支持 Cloudflare R2、AWS S3、MinIO、阿里 OSS（S3 网关）、腾讯 COS（S3 网关）等。

import { ipcMain, safeStorage, app, BrowserWindow } from 'electron'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import fs from 'node:fs'
import path from 'node:path'

// ==================== 类型 ====================

export interface ObjectStorageConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** 自定义公开访问域名（可选）。若设置则返回直链而非 Presigned URL */
  publicBase?: string
  /** 是否启用 path-style（MinIO 必须 true，R2/S3 通常 false 但 true 也兼容） */
  forcePathStyle?: boolean
  /** Presigned URL 有效期（秒），默认 6 小时 */
  presignExpires?: number
  /** 是否启用自动清理（启动时 + 每 24 小时） */
  autoCleanEnabled?: boolean
  /** 保留天数（删除超过该天数的对象），默认 3 */
  retentionDays?: number
  /** 容量阈值（字节），超过则按时间从旧到新删除直到回到该阈值以下，默认 8GB */
  maxStorageBytes?: number
}

interface StoredConfig extends Omit<ObjectStorageConfig, 'secretAccessKey'> {
  /** base64 编码的密文（safeStorage 加密） 或者明文（不可用时） */
  secretAccessKey: string
  encrypted: boolean
}

// ==================== 配置存储 ====================

function getConfigPath() {
  return path.join(app.getPath('userData'), 'object-storage-config.json')
}

function readStoredConfig(): StoredConfig | null {
  try {
    const file = getConfigPath()
    if (!fs.existsSync(file)) return null
    const raw = fs.readFileSync(file, 'utf-8')
    return JSON.parse(raw) as StoredConfig
  } catch {
    return null
  }
}

function writeStoredConfig(cfg: StoredConfig) {
  const file = getConfigPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf-8')
}

function encryptSecret(secret: string): { value: string; encrypted: boolean } {
  if (safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(secret)
    return { value: buf.toString('base64'), encrypted: true }
  }
  return { value: secret, encrypted: false }
}

function decryptSecret(stored: StoredConfig): string {
  if (!stored.encrypted) return stored.secretAccessKey
  try {
    const buf = Buffer.from(stored.secretAccessKey, 'base64')
    return safeStorage.decryptString(buf)
  } catch {
    return ''
  }
}

function loadActiveConfig(): ObjectStorageConfig | null {
  const stored = readStoredConfig()
  if (!stored) return null
  const secret = decryptSecret(stored)
  if (!secret) return null
  return {
    endpoint: stored.endpoint,
    region: stored.region,
    bucket: stored.bucket,
    accessKeyId: stored.accessKeyId,
    secretAccessKey: secret,
    publicBase: stored.publicBase,
    forcePathStyle: stored.forcePathStyle,
    presignExpires: stored.presignExpires,
  }
}

// ==================== S3 客户端 ====================

function buildClient(cfg: ObjectStorageConfig) {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region || 'auto',
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: cfg.forcePathStyle ?? true,
  })
}

// ==================== 工具 ====================

const MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function guessMime(filePath: string, fallback?: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_MAP[ext] || fallback || 'application/octet-stream'
}

function genObjectKey(filePath: string): string {
  const ext = path.extname(filePath) || ''
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 10)
  return `moyin/${ts}-${rand}${ext}`
}

const MAX_VIDEO_SIZE = 1024 * 1024 * 1024 // 1GB
const MAX_AUDIO_SIZE = 200 * 1024 * 1024 // 200MB（保守上限）

/** 用于在对象存储中识别本应用上传的对象前缀 */
const OBJECT_KEY_PREFIX = 'moyin/'
/** 默认保留天数 */
const DEFAULT_RETENTION_DAYS = 3
/** 默认容量阈值 8GB */
const DEFAULT_MAX_STORAGE = 8 * 1024 * 1024 * 1024
/** 自动清理周期：24 小时 */
const AUTO_CLEAN_INTERVAL_MS = 24 * 60 * 60 * 1000

function validateSize(filePath: string, size: number) {
  const mime = guessMime(filePath)
  if (mime.startsWith('video/') && size > MAX_VIDEO_SIZE) {
    throw new Error(`视频文件超过 1GB 限制（当前 ${(size / 1024 / 1024).toFixed(1)} MB）`)
  }
  if (mime.startsWith('audio/') && size > MAX_AUDIO_SIZE) {
    throw new Error(`音频文件超过 200MB 限制（当前 ${(size / 1024 / 1024).toFixed(1)} MB）`)
  }
}

// ==================== IPC 注册 ====================

export function registerUploaderIpc() {
  // 保存配置
  ipcMain.handle('object-storage:save-config', async (_e, payload: ObjectStorageConfig) => {
    if (!payload || typeof payload !== 'object') throw new Error('配置无效')
    const { endpoint, region, bucket, accessKeyId, secretAccessKey } = payload
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('endpoint / bucket / accessKeyId / secretAccessKey 均为必填')
    }
    // 若 secret 是占位符（******），保留原密钥
    let actualSecret = secretAccessKey
    if (/^\*+$/.test(secretAccessKey)) {
      const old = readStoredConfig()
      if (!old) throw new Error('未找到原配置，请填写完整密钥')
      actualSecret = decryptSecret(old)
      if (!actualSecret) throw new Error('原密钥已损坏，请重新填写')
    }
    const enc = encryptSecret(actualSecret)
    const stored: StoredConfig = {
      endpoint: endpoint.trim(),
      region: (region || 'auto').trim(),
      bucket: bucket.trim(),
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: enc.value,
      encrypted: enc.encrypted,
      publicBase: payload.publicBase?.trim() || undefined,
      forcePathStyle: payload.forcePathStyle ?? true,
      presignExpires: payload.presignExpires ?? 3600 * 6,
      autoCleanEnabled: payload.autoCleanEnabled ?? true,
      retentionDays: payload.retentionDays ?? DEFAULT_RETENTION_DAYS,
      maxStorageBytes: payload.maxStorageBytes ?? DEFAULT_MAX_STORAGE,
    }
    writeStoredConfig(stored)
    return { ok: true }
  })

  // 读取配置（密钥脱敏）
  ipcMain.handle('object-storage:get-config', async () => {
    const s = readStoredConfig()
    if (!s) return null
    return {
      endpoint: s.endpoint,
      region: s.region,
      bucket: s.bucket,
      accessKeyId: s.accessKeyId,
      secretAccessKey: s.secretAccessKey ? '******' : '',
      publicBase: s.publicBase || '',
      forcePathStyle: s.forcePathStyle ?? true,
      presignExpires: s.presignExpires ?? 3600 * 6,
      autoCleanEnabled: s.autoCleanEnabled ?? true,
      retentionDays: s.retentionDays ?? DEFAULT_RETENTION_DAYS,
      maxStorageBytes: s.maxStorageBytes ?? DEFAULT_MAX_STORAGE,
      encrypted: s.encrypted,
    }
  })

  // 是否已配置
  ipcMain.handle('object-storage:is-configured', async () => {
    return !!loadActiveConfig()
  })

  // 测试连接
  ipcMain.handle('object-storage:test', async (_e, payload?: ObjectStorageConfig) => {
    let cfg = payload
    if (cfg && /^\*+$/.test(cfg.secretAccessKey)) {
      const persisted = loadActiveConfig()
      if (!persisted) throw new Error('请先保存配置或填写完整密钥')
      cfg = { ...cfg, secretAccessKey: persisted.secretAccessKey }
    }
    if (!cfg) cfg = loadActiveConfig() || undefined
    if (!cfg) throw new Error('未配置对象存储')
    const client = buildClient(cfg)
    try {
      await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }))
      return { ok: true }
    } catch (err: any) {
      throw new Error(err?.message || '连接失败')
    }
  })

  // 上传本地文件 → 返回可访问 URL
  ipcMain.handle('object-storage:upload', async (event, filePath: string) => {
    const cfg = loadActiveConfig()
    if (!cfg) throw new Error('对象存储未配置，请前往「设置 → 图床配置 → 对象存储」配置')
    if (!filePath || typeof filePath !== 'string') throw new Error('文件路径无效')
    if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`)
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) throw new Error('不是一个文件')
    validateSize(filePath, stat.size)

    const key = genObjectKey(filePath)
    const contentType = guessMime(filePath)
    const senderWin = BrowserWindow.fromWebContents(event.sender)

    const sendProgress = (loaded: number, total: number) => {
      if (senderWin && !senderWin.isDestroyed()) {
        senderWin.webContents.send('object-storage:progress', {
          filePath,
          loaded,
          total,
        })
      }
    }

    const client = buildClient(cfg)
    const stream = fs.createReadStream(filePath)
    const upload = new Upload({
      client,
      params: {
        Bucket: cfg.bucket,
        Key: key,
        Body: stream,
        ContentType: contentType,
        ContentLength: stat.size,
      },
      // 5MB part size, 4 并发分片
      queueSize: 4,
      partSize: 5 * 1024 * 1024,
      leavePartsOnError: false,
    })

    upload.on('httpUploadProgress', (p) => {
      sendProgress(p.loaded ?? 0, p.total ?? stat.size)
    })

    try {
      await upload.done()
    } catch (err: any) {
      throw new Error(`上传失败：${err?.message || err}`)
    } finally {
      try { stream.close() } catch { /* noop */ }
    }

    // 通知 100%
    sendProgress(stat.size, stat.size)

    // 生成访问 URL
    if (cfg.publicBase) {
      return `${cfg.publicBase.replace(/\/$/, '')}/${key}`
    }
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
      { expiresIn: cfg.presignExpires ?? 3600 * 6 },
    )
    return url
  })

  // ============================================================
  // 列表 / 用量 / 清理
  // ============================================================

  // 列出 moyin/ 前缀下所有对象（用于统计与清理）
  ipcMain.handle('object-storage:get-usage', async () => {
    const cfg = loadActiveConfig()
    if (!cfg) throw new Error('对象存储未配置')
    const client = buildClient(cfg)
    let totalBytes = 0
    let totalCount = 0
    let oldest: Date | null = null
    let newest: Date | null = null
    let continuationToken: string | undefined
    do {
      const resp: any = await client.send(new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: OBJECT_KEY_PREFIX,
        ContinuationToken: continuationToken,
      }))
      const items: any[] = resp.Contents || []
      for (const it of items) {
        totalBytes += it.Size || 0
        totalCount += 1
        const lm: Date | undefined = it.LastModified
        if (lm) {
          if (!oldest || lm < oldest) oldest = lm
          if (!newest || lm > newest) newest = lm
        }
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined
    } while (continuationToken)
    return {
      totalBytes,
      totalCount,
      oldest: oldest ? oldest.getTime() : null,
      newest: newest ? newest.getTime() : null,
      maxStorageBytes: cfg.maxStorageBytes ?? DEFAULT_MAX_STORAGE,
      retentionDays: cfg.retentionDays ?? DEFAULT_RETENTION_DAYS,
      autoCleanEnabled: cfg.autoCleanEnabled ?? true,
    }
  })

  // 清理：删除超过保留天数的对象 + 若总量仍超 maxStorageBytes 则按时间从旧到新继续删
  ipcMain.handle(
    'object-storage:cleanup',
    async (_e, opts?: { retentionDays?: number; deleteAll?: boolean }) => {
      const cfg = loadActiveConfig()
      if (!cfg) throw new Error('对象存储未配置')
      const result = await runCleanup(cfg, {
        retentionDays: opts?.retentionDays ?? cfg.retentionDays ?? DEFAULT_RETENTION_DAYS,
        deleteAll: !!opts?.deleteAll,
        maxStorageBytes: cfg.maxStorageBytes ?? DEFAULT_MAX_STORAGE,
      })
      return result
    },
  )

  // 启动后异步触发一次自动清理（不阻塞窗口）
  setTimeout(() => { void tryAutoCleanup() }, 10_000)
  // 之后每 24 小时触发一次
  setInterval(() => { void tryAutoCleanup() }, AUTO_CLEAN_INTERVAL_MS)
}

// ============================================================
// 清理实现
// ============================================================

interface CleanupOptions {
  retentionDays: number
  deleteAll: boolean
  maxStorageBytes: number
}

interface CleanupResult {
  deletedCount: number
  deletedBytes: number
  remainingCount: number
  remainingBytes: number
}

async function listAllObjects(client: S3Client, bucket: string) {
  const out: { Key: string; Size: number; LastModified: Date }[] = []
  let token: string | undefined
  do {
    const resp: any = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: OBJECT_KEY_PREFIX,
      ContinuationToken: token,
    }))
    const items: any[] = resp.Contents || []
    for (const it of items) {
      if (!it.Key) continue
      out.push({
        Key: it.Key,
        Size: it.Size || 0,
        LastModified: it.LastModified || new Date(0),
      })
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined
  } while (token)
  return out
}

async function deleteKeys(client: S3Client, bucket: string, keys: string[]) {
  // S3 DeleteObjects 单次最多 1000 个
  let deleted = 0
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }))
    deleted += batch.length
  }
  return deleted
}

async function runCleanup(cfg: ObjectStorageConfig, opts: CleanupOptions): Promise<CleanupResult> {
  const client = buildClient(cfg)
  const all = await listAllObjects(client, cfg.bucket)
  // 按修改时间升序（最旧排前）
  all.sort((a, b) => a.LastModified.getTime() - b.LastModified.getTime())

  const toDelete: { Key: string; Size: number }[] = []

  if (opts.deleteAll) {
    toDelete.push(...all)
  } else {
    const cutoff = Date.now() - opts.retentionDays * 24 * 60 * 60 * 1000
    // 第 1 步：删除超过保留期的
    const expired = all.filter((o) => o.LastModified.getTime() < cutoff)
    toDelete.push(...expired)

    // 第 2 步：若剩余总量仍超阈值，从旧到新继续删
    const remaining = all.filter((o) => o.LastModified.getTime() >= cutoff)
    let remainingBytes = remaining.reduce((s, o) => s + o.Size, 0)
    for (const obj of remaining) {
      if (remainingBytes <= opts.maxStorageBytes) break
      toDelete.push(obj)
      remainingBytes -= obj.Size
    }
  }

  const deletedKeys = toDelete.map((o) => o.Key)
  const deletedBytes = toDelete.reduce((s, o) => s + o.Size, 0)
  if (deletedKeys.length > 0) {
    await deleteKeys(client, cfg.bucket, deletedKeys)
  }

  const totalBytes = all.reduce((s, o) => s + o.Size, 0)
  return {
    deletedCount: deletedKeys.length,
    deletedBytes,
    remainingCount: all.length - deletedKeys.length,
    remainingBytes: totalBytes - deletedBytes,
  }
}

let autoCleanRunning = false
async function tryAutoCleanup() {
  if (autoCleanRunning) return
  const cfg = loadActiveConfig()
  if (!cfg) return
  if (cfg.autoCleanEnabled === false) return
  autoCleanRunning = true
  try {
    const r = await runCleanup(cfg, {
      retentionDays: cfg.retentionDays ?? DEFAULT_RETENTION_DAYS,
      deleteAll: false,
      maxStorageBytes: cfg.maxStorageBytes ?? DEFAULT_MAX_STORAGE,
    })
    if (r.deletedCount > 0) {
      console.log(`[uploader] auto-cleanup deleted ${r.deletedCount} objects (${(r.deletedBytes / 1024 / 1024).toFixed(1)} MB)`)
    }
  } catch (err) {
    console.warn('[uploader] auto-cleanup failed:', err)
  } finally {
    autoCleanRunning = false
  }
}
