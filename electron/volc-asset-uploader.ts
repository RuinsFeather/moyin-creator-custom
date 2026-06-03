// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
//
// 火山引擎方舟 Assets API 上传模块
// 使用 AK/SK V4 签名鉴权，将素材上传到指定项目（youdianchuangyi）
// 完整流程：创建素材组 → 上传素材 → 轮询状态 → 返回 Asset URI

import { ipcMain, safeStorage, app, net } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// ==================== 常量 ====================

const ARK_HOST = 'ark.cn-beijing.volcengineapi.com'
const ARK_SERVICE = 'ark'
const ARK_REGION = 'cn-beijing'
const ARK_API_VERSION = '2024-01-01'
const DEFAULT_PROJECT_NAME = 'youdianchuangyi'

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 3000
/** 轮询超时（毫秒），2 分钟 */
const POLL_TIMEOUT_MS = 2 * 60 * 1000
/** Ark Assets 接口最小请求间隔，避免多图上传/轮询时触发 429 */
const ARK_REQUEST_MIN_INTERVAL_MS = 350

let lastArkRequestAt = 0

async function throttleArkRequest() {
  const now = Date.now()
  const waitMs = Math.max(0, lastArkRequestAt + ARK_REQUEST_MIN_INTERVAL_MS - now)
  if (waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitMs))
  }
  lastArkRequestAt = Date.now()
}

function toFriendlyArkError(action: string, status: number, message: string): Error {
  if (status === 429 || /Too Many Requests|throttl|rate limit|RequestLimitExceeded/i.test(message)) {
    return new Error(`火山素材接口请求过于频繁，请稍后重试（${action}，429 Too Many Requests）`)
  }
  return new Error(`Ark API ${action} 失败 (${status}): ${message}`)
}

// ==================== 类型 ====================

export interface VolcAssetCredentials {
  accessKeyId: string
  secretAccessKey: string
}

export interface VolcAssetConfig {
  accessKeyId: string
  secretAccessKey: string
  projectName?: string
}

interface StoredVolcAssetConfig {
  accessKeyId: string
  /** base64 编码的密文（safeStorage 加密） 或者明文 */
  secretAccessKey: string
  projectName: string
  encrypted: boolean
}

export interface CreateAssetGroupResult {
  groupId: string
  name: string
}

export interface CreateAssetResult {
  assetId: string
}

export interface AssetStatus {
  id: string
  status: 'Processing' | 'Active' | 'Failed'
  url?: string
  error?: string
}

export interface VolcAssetUploadResult {
  assetId: string
  assetUri: string   // Asset://<assetId>
  url: string        // 处理后的素材地址
  groupId: string
}

// ==================== V4 签名算法 ====================

function hmacSHA256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
}

/**
 * 生成火山引擎 V4 签名（HMAC-SHA256）
 * 参考文档：https://www.volcengine.com/docs/6369/67270
 */
function signV4(params: {
  method: string
  path: string
  query: string
  headers: Record<string, string>
  body: string
  credentials: VolcAssetCredentials
  service: string
  region: string
  date: string        // 格式 YYYYMMDD
  dateTime: string    // 格式 YYYYMMDDTHHmmssZ
}): string {
  const { method, path: reqPath, query, headers, body, credentials, service, region, date, dateTime } = params

  // 1. 构造 CanonicalRequest
  const signedHeaderKeys = Object.keys(headers)
    .map(k => k.toLowerCase())
    .sort()
  const signedHeadersStr = signedHeaderKeys.join(';')

  const canonicalHeaders = signedHeaderKeys
    .map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!].trim()}`)
    .join('\n') + '\n'

  const payloadHash = sha256Hex(body)

  const canonicalRequest = [
    method.toUpperCase(),
    reqPath,
    query,
    canonicalHeaders,
    signedHeadersStr,
    payloadHash,
  ].join('\n')

  // 2. 构造 StringToSign
  const credentialScope = `${date}/${region}/${service}/request`
  const stringToSign = [
    'HMAC-SHA256',
    dateTime,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  // 3. 计算签名密钥
  const kDate = hmacSHA256(credentials.secretAccessKey, date)
  const kRegion = hmacSHA256(kDate, region)
  const kService = hmacSHA256(kRegion, service)
  const kSigning = hmacSHA256(kService, 'request')

  // 4. 计算签名
  const signature = hmacSHA256(kSigning, stringToSign).toString('hex')

  // 5. 组装 Authorization
  return `HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`
}

// ==================== HTTP 请求封装 ====================

async function arkApiRequest<T>(params: {
  action: string
  body: Record<string, unknown>
  credentials: VolcAssetCredentials
  timeoutMs?: number
}): Promise<T> {
  const { action, body, credentials, timeoutMs = 30_000 } = params
  const bodyStr = JSON.stringify(body)

  // 时间戳
  const now = new Date()
  const dateTime = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const date = dateTime.slice(0, 8)

  // Query string
  const queryParams = new URLSearchParams({
    Action: action,
    Version: ARK_API_VERSION,
  })
  queryParams.sort()
  const queryString = queryParams.toString()

  // Headers（用于签名计算，包含 Host）
  const payloadHash = sha256Hex(bodyStr)
  const headersForSign: Record<string, string> = {
    'Content-Type': 'application/json',
    'Host': ARK_HOST,
    'X-Content-Sha256': payloadHash,
    'X-Date': dateTime,
  }

  // 签名
  const authorization = signV4({
    method: 'POST',
    path: '/',
    query: queryString,
    headers: headersForSign,
    body: bodyStr,
    credentials,
    service: ARK_SERVICE,
    region: ARK_REGION,
    date,
    dateTime,
  })

  // 实际发送的 headers（不含 Host，Electron net.fetch 会自动从 URL 推导 Host）
  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Content-Sha256': payloadHash,
    'X-Date': dateTime,
    'Authorization': authorization,
  }

  // 发起请求
  const url = `https://${ARK_HOST}/?${queryString}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    await throttleArkRequest()
    const resp = await net.fetch(url, {
      method: 'POST',
      headers: fetchHeaders,
      body: bodyStr,
      signal: controller.signal,
    })

    const text = await resp.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Ark API 返回非 JSON 响应 (${resp.status}): ${text.slice(0, 500)}`)
    }

    if (!resp.ok) {
      const errMsg = data?.ResponseMetadata?.Error?.Message
        || data?.ResponseMetadata?.Error?.Code
        || data?.message
        || text.slice(0, 300)
      throw toFriendlyArkError(action, resp.status, errMsg)
    }

    // 检查业务层错误
    const metadata = data?.ResponseMetadata
    if (metadata?.Error?.Code) {
      throw new Error(`Ark API ${action} 业务错误: ${metadata.Error.Code} - ${metadata.Error.Message}`)
    }

    return data as T
  } finally {
    clearTimeout(timer)
  }
}

// ==================== 核心业务逻辑 ====================

/**
 * 步骤 1：创建素材资产组合
 */
async function createAssetGroup(params: {
  name: string
  description?: string
  credentials: VolcAssetCredentials
  projectName?: string
}): Promise<CreateAssetGroupResult> {
  const { name, description, credentials, projectName = DEFAULT_PROJECT_NAME } = params

  const resp = await arkApiRequest<{
    Result: { Id: string; Name: string }
  }>({
    action: 'CreateAssetGroup',
    body: {
      Name: name,
      Description: description || '',
      GroupType: 'AIGC',
      ProjectName: projectName,
    },
    credentials,
  })

  return {
    groupId: resp.Result.Id,
    name: resp.Result.Name,
  }
}

/**
 * 步骤 2：上传素材资产
 */
async function createAsset(params: {
  groupId: string
  imageUrl: string
  name?: string
  credentials: VolcAssetCredentials
  projectName?: string
}): Promise<CreateAssetResult> {
  const { groupId, imageUrl, name, credentials, projectName = DEFAULT_PROJECT_NAME } = params

  const resp = await arkApiRequest<{
    Result: { Id: string }
  }>({
    action: 'CreateAsset',
    body: {
      GroupId: groupId,
      URL: imageUrl,
      AssetType: 'Image',
      Name: name || '',
      ProjectName: projectName,
    },
    credentials,
  })

  return {
    assetId: resp.Result.Id,
  }
}

/**
 * 步骤 3：查询素材状态
 */
async function getAssetStatus(params: {
  assetId: string
  credentials: VolcAssetCredentials
  projectName?: string
}): Promise<AssetStatus> {
  const { assetId, credentials, projectName = DEFAULT_PROJECT_NAME } = params

  const resp = await arkApiRequest<{
    Result: {
      Id: string
      Status: 'Processing' | 'Active' | 'Failed'
      URL?: string
      Error?: { Message?: string; Code?: string }
    }
  }>({
    action: 'GetAsset',
    body: {
      Id: assetId,
      ProjectName: projectName,
    },
    credentials,
  })

  return {
    id: resp.Result.Id,
    status: resp.Result.Status,
    url: resp.Result.URL,
    error: resp.Result.Error?.Message || resp.Result.Error?.Code,
  }
}

/**
 * 步骤 3（自动轮询版本）：等待素材变为 Active
 */
async function waitForAssetReady(params: {
  assetId: string
  credentials: VolcAssetCredentials
  projectName?: string
  pollInterval?: number
  timeout?: number
  onProgress?: (status: string) => void
}): Promise<AssetStatus> {
  const {
    assetId,
    credentials,
    projectName,
    pollInterval = POLL_INTERVAL_MS,
    timeout = POLL_TIMEOUT_MS,
    onProgress,
  } = params

  const start = Date.now()

  while (true) {
    const status = await getAssetStatus({ assetId, credentials, projectName })

    if (status.status === 'Active') {
      onProgress?.('Active')
      return status
    }

    if (status.status === 'Failed') {
      throw new Error(`素材处理失败: ${status.error || '未知错误'}`)
    }

    // Processing: 继续轮询
    onProgress?.('Processing')

    if (Date.now() - start > timeout) {
      throw new Error(`素材处理超时（${Math.round(timeout / 1000)} 秒），AssetId: ${assetId}`)
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }
}

/**
 * 完整上传流程：创建组 → 上传 → 轮询 → 返回 Asset URI
 */
async function uploadAssetFull(params: {
  imageUrl: string
  groupName: string
  groupDescription?: string
  assetName?: string
  credentials: VolcAssetCredentials
  projectName?: string
  /** 复用已有的 GroupId（跳过创建组步骤） */
  existingGroupId?: string
  onProgress?: (step: string, detail?: string) => void
}): Promise<VolcAssetUploadResult> {
  const {
    imageUrl,
    groupName,
    groupDescription,
    assetName,
    credentials,
    projectName = DEFAULT_PROJECT_NAME,
    existingGroupId,
    onProgress,
  } = params

  // 步骤 1：创建/复用素材组
  let groupId: string
  if (existingGroupId) {
    groupId = existingGroupId
    onProgress?.('group', `复用素材组: ${groupId}`)
  } else {
    onProgress?.('group', `正在创建素材组: ${groupName}`)
    const group = await createAssetGroup({
      name: groupName,
      description: groupDescription,
      credentials,
      projectName,
    })
    groupId = group.groupId
    onProgress?.('group', `素材组已创建: ${groupId}`)
  }

  // 步骤 2：上传素材
  onProgress?.('upload', `正在上传素材: ${imageUrl.slice(0, 80)}...`)
  const asset = await createAsset({
    groupId,
    imageUrl,
    name: assetName,
    credentials,
    projectName,
  })
  onProgress?.('upload', `素材已提交: ${asset.assetId}`)

  // 步骤 3：轮询等待处理完成
  onProgress?.('poll', '等待素材处理...')
  const finalStatus = await waitForAssetReady({
    assetId: asset.assetId,
    credentials,
    projectName,
    onProgress: (s) => onProgress?.('poll', s),
  })

  const assetUri = `Asset://${asset.assetId}`
  onProgress?.('done', assetUri)

  return {
    assetId: asset.assetId,
    assetUri,
    url: finalStatus.url || '',
    groupId,
  }
}

// ==================== 配置持久化（AK/SK 加密存储） ====================

function getVolcAssetConfigPath(): string {
  return path.join(app.getPath('userData'), 'volc-asset-config.json')
}

function readStoredVolcAssetConfig(): StoredVolcAssetConfig | null {
  try {
    const file = getVolcAssetConfigPath()
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as StoredVolcAssetConfig
  } catch {
    return null
  }
}

function writeStoredVolcAssetConfig(cfg: StoredVolcAssetConfig) {
  const file = getVolcAssetConfigPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf-8')
}

function encryptAKSK(secret: string): { value: string; encrypted: boolean } {
  if (safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(secret)
    return { value: buf.toString('base64'), encrypted: true }
  }
  return { value: secret, encrypted: false }
}

function decryptAKSK(stored: StoredVolcAssetConfig): string {
  if (!stored.encrypted) return stored.secretAccessKey
  try {
    const buf = Buffer.from(stored.secretAccessKey, 'base64')
    return safeStorage.decryptString(buf)
  } catch {
    return ''
  }
}

function loadVolcAssetCredentials(): (VolcAssetCredentials & { projectName: string }) | null {
  const stored = readStoredVolcAssetConfig()
  if (!stored) return null
  const secret = decryptAKSK(stored)
  if (!secret) return null
  return {
    accessKeyId: stored.accessKeyId,
    secretAccessKey: secret,
    projectName: stored.projectName || DEFAULT_PROJECT_NAME,
  }
}

// ==================== IPC 注册 ====================

export function registerVolcAssetIpc() {
  // 保存 AK/SK 配置
  ipcMain.handle('volc-asset:save-config', async (_e, payload: VolcAssetConfig) => {
    if (!payload?.accessKeyId || !payload?.secretAccessKey) {
      throw new Error('Access Key ID 和 Secret Access Key 不能为空')
    }
    // 若 secret 是占位符，保留原密钥
    let actualSecret = payload.secretAccessKey
    if (/^\*+$/.test(actualSecret)) {
      const old = readStoredVolcAssetConfig()
      if (!old) throw new Error('未找到原配置，请填写完整 Secret Access Key')
      actualSecret = decryptAKSK(old)
      if (!actualSecret) throw new Error('原密钥已损坏，请重新填写')
    }
    const enc = encryptAKSK(actualSecret)
    writeStoredVolcAssetConfig({
      accessKeyId: payload.accessKeyId.trim(),
      secretAccessKey: enc.value,
      projectName: (payload.projectName || DEFAULT_PROJECT_NAME).trim(),
      encrypted: enc.encrypted,
    })
    return { ok: true }
  })

  // 获取配置（SK 脱敏返回）
  ipcMain.handle('volc-asset:get-config', async () => {
    const stored = readStoredVolcAssetConfig()
    if (!stored) return null
    return {
      accessKeyId: stored.accessKeyId,
      secretAccessKey: '********',
      projectName: stored.projectName || DEFAULT_PROJECT_NAME,
    }
  })

  // 检查是否已配置
  ipcMain.handle('volc-asset:is-configured', async () => {
    return loadVolcAssetCredentials() !== null
  })

  // 创建素材组
  ipcMain.handle('volc-asset:create-group', async (_e, payload: {
    name: string
    description?: string
    projectName?: string
  }) => {
    const cred = loadVolcAssetCredentials()
    if (!cred) throw new Error('请先配置火山引擎 AK/SK')
    return createAssetGroup({
      name: payload.name,
      description: payload.description,
      credentials: cred,
      projectName: payload.projectName || cred.projectName,
    })
  })

  // 上传单张素材
  ipcMain.handle('volc-asset:create-asset', async (_e, payload: {
    groupId: string
    imageUrl: string
    name?: string
    projectName?: string
  }) => {
    const cred = loadVolcAssetCredentials()
    if (!cred) throw new Error('请先配置火山引擎 AK/SK')
    return createAsset({
      groupId: payload.groupId,
      imageUrl: payload.imageUrl,
      name: payload.name,
      credentials: cred,
      projectName: payload.projectName || cred.projectName,
    })
  })

  // 查询素材状态
  ipcMain.handle('volc-asset:get-status', async (_e, payload: {
    assetId: string
    projectName?: string
  }) => {
    const cred = loadVolcAssetCredentials()
    if (!cred) throw new Error('请先配置火山引擎 AK/SK')
    return getAssetStatus({
      assetId: payload.assetId,
      credentials: cred,
      projectName: payload.projectName || cred.projectName,
    })
  })

  // 完整上传流程（创建组 + 上传 + 轮询）
  ipcMain.handle('volc-asset:upload-full', async (_e, payload: {
    imageUrl: string
    groupName: string
    groupDescription?: string
    assetName?: string
    existingGroupId?: string
    projectName?: string
  }) => {
    const cred = loadVolcAssetCredentials()
    if (!cred) throw new Error('请先配置火山引擎 AK/SK')
    return uploadAssetFull({
      imageUrl: payload.imageUrl,
      groupName: payload.groupName,
      groupDescription: payload.groupDescription,
      assetName: payload.assetName,
      existingGroupId: payload.existingGroupId,
      credentials: cred,
      projectName: payload.projectName || cred.projectName,
    })
  })

  // 批量上传：多张图片到同一组
  ipcMain.handle('volc-asset:batch-upload', async (_e, payload: {
    imageUrls: string[]
    groupName: string
    groupDescription?: string
    existingGroupId?: string
    projectName?: string
  }) => {
    const cred = loadVolcAssetCredentials()
    if (!cred) throw new Error('请先配置火山引擎 AK/SK')

    const projectName = payload.projectName || cred.projectName

    // 创建/复用组
    let groupId = payload.existingGroupId
    if (!groupId) {
      const group = await createAssetGroup({
        name: payload.groupName,
        description: payload.groupDescription,
        credentials: cred,
        projectName,
      })
      groupId = group.groupId
    }

    // 逐张上传（受 QPS=30 限制，串行更安全）
    const results: Array<{
      imageUrl: string
      assetId?: string
      assetUri?: string
      url?: string
      error?: string
    }> = []

    for (const imageUrl of payload.imageUrls) {
      try {
        const asset = await createAsset({
          groupId,
          imageUrl,
          credentials: cred,
          projectName,
        })

        const status = await waitForAssetReady({
          assetId: asset.assetId,
          credentials: cred,
          projectName,
        })

        results.push({
          imageUrl,
          assetId: asset.assetId,
          assetUri: `Asset://${asset.assetId}`,
          url: status.url,
        })
      } catch (err) {
        results.push({
          imageUrl,
          error: (err as Error)?.message || String(err),
        })
      }
    }

    return { groupId, results }
  })
}
