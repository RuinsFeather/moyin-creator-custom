// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Blueprint error utilities (§11.3)
//
// Provides:
//   1. sanitizeErrorMessage() — strips API keys, tokens, and sensitive URLs
//   2. categorizeError() — classifies errors as network / auth / validation / api / unknown
//   3. isRecoverable() — determines if an error is transient and retryable
//   4. getRecoveryAction() — suggests actionable recovery steps for each error category

// ── Error categories ─────────────────────────────────────────────────────

export type ErrorCategory =
  | 'network'     // 连接中断、超时、DNS 失败
  | 'auth'        // 401/403、API key 无效或缺失
  | 'validation'  // 参数校验、输入不合法
  | 'api'         // 上游 API 业务错误（5xx、限流等）
  | 'cancelled'   // 用户取消
  | 'blocked'     // 上游节点失败导致阻断
  | 'unknown';    // 无法分类

export interface ErrorInfo {
  /** 原始错误消息（已脱敏） */
  message: string;
  /** 错误分类 */
  category: ErrorCategory;
  /** 是否可恢复（可重试） */
  recoverable: boolean;
  /** 建议的恢复动作 */
  recoveryAction: string;
  /** 建议的恢复动作图标 */
  recoveryIcon: string;
}

// ── Sensitive pattern detection ──────────────────────────────────────────

/**
 * Patterns that indicate API keys, tokens, or sensitive URLs.
 * Each pattern is tested case-insensitively against the error message.
 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // API keys in URLs: ?key=..., &key=..., ?api_key=..., etc.
  { pattern: /([?&])(key|api_key|apikey|api-key|token|access_token|secret|authorization)=([^&\s]+)/gi,
    replacement: '$1$2=***' },
  // Bearer tokens
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: 'Bearer ***' },
  // Authorization header values
  { pattern: /Authorization[:\s]+[^\s,;]+/gi,
    replacement: 'Authorization: ***' },
  // Long hex strings that look like tokens (32+ chars)
  { pattern: /\b[a-f0-9]{32,}\b/gi,
    replacement: '***' },
  // URLs with embedded credentials: https://user:pass@host
  { pattern: /(https?:\/\/)[^@\s]+@/gi,
    replacement: '$1***@' },
  // Common API key prefixes with their values
  { pattern: /sk-[A-Za-z0-9]{20,}/g,
    replacement: 'sk-***' },
  { pattern: /ghp_[A-Za-z0-9]{20,}/g,
    replacement: 'ghp_***' },
];

/**
 * Sanitize an error message by removing API keys, tokens, and other
 * sensitive information that should never be shown in the UI.
 *
 * §11.3 — 提示词和 API 错误中不得泄漏 API Key
 */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

// ── Error categorization ─────────────────────────────────────────────────

/** Keywords/patterns that indicate network errors. */
const NETWORK_PATTERNS = [
  /fetch failed/i,
  /network\s*error/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /socket hang up/i,
  /Failed to fetch/i,
  /NetworkError/i,
  /ERR_NETWORK/i,
  /ERR_CONNECTION/i,
  /ERR_INTERNET_DISCONNECTED/i,
  /请求超时/i,
  /网络.*(中断|错误|异常)/i,
  /连接.*失败/i,
  /无法连接/i,
];

/** Keywords/patterns that indicate auth errors. */
const AUTH_PATTERNS = [
  /401/,
  /403/,
  /unauthorized/i,
  /forbidden/i,
  /invalid.*key/i,
  /api.*key.*invalid/i,
  /authentication/i,
  /access.denied/i,
  /未授权/,
  /API.*配置/,
  /请在.*设置.*配置/i,
];

/** Keywords/patterns that indicate validation errors. */
const VALIDATION_PATTERNS = [
  /参数/i,
  /必填/i,
  /格式.*无效/i,
  /不支持/i,
  /需要.*上传/i,
  /至少.*张/i,
  /最多.*张/i,
  /仅支持/i,
  /请填写/i,
  /invalid.*param/i,
  /validation/i,
  /required/i,
];

/** HTTP status codes that are typically retryable. */
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Categorize an error message into a category and determine if it's recoverable.
 */
export function categorizeError(message: string, status?: number): ErrorInfo {
  const sanitized = sanitizeErrorMessage(message);

  // 1. Check for blocked upstream
  if (sanitized.includes('上游节点') && sanitized.includes('失败')) {
    return {
      message: sanitized,
      category: 'blocked',
      recoverable: false,
      recoveryAction: '请先修复上游节点的错误，然后重试',
      recoveryIcon: '🔗',
    };
  }

  // 2. Check for cancellation
  if (sanitized.includes('取消') || sanitized.includes('AbortError') || sanitized.includes('cancelled')) {
    return {
      message: sanitized,
      category: 'cancelled',
      recoverable: true,
      recoveryAction: '可以重新运行',
      recoveryIcon: '▶',
    };
  }

  // 3. Check for network errors
  if (NETWORK_PATTERNS.some((p) => p.test(sanitized)) || (status !== undefined && [502, 503, 504].includes(status))) {
    return {
      message: sanitized,
      category: 'network',
      recoverable: true,
      recoveryAction: '网络中断，请检查网络后重试',
      recoveryIcon: '🔄',
    };
  }

  // 4. Check for auth errors
  if (AUTH_PATTERNS.some((p) => p.test(sanitized)) || status === 401 || status === 403) {
    return {
      message: sanitized,
      category: 'auth',
      recoverable: false,
      recoveryAction: '请在设置中检查 API 配置',
      recoveryIcon: '⚙️',
    };
  }

  // 5. Check for retryable API errors (rate limit, server errors)
  if (status !== undefined && RETRYABLE_STATUS_CODES.includes(status)) {
    return {
      message: sanitized,
      category: 'api',
      recoverable: true,
      recoveryAction: status === 429 ? '请求过于频繁，请稍后重试' : '服务暂时不可用，请稍后重试',
      recoveryIcon: '🔄',
    };
  }

  // 6. Check for validation errors
  if (VALIDATION_PATTERNS.some((p) => p.test(sanitized))) {
    return {
      message: sanitized,
      category: 'validation',
      recoverable: false,
      recoveryAction: '请检查节点配置参数',
      recoveryIcon: '⚙️',
    };
  }

  // 7. Default: unknown
  return {
    message: sanitized,
    category: 'unknown',
    recoverable: false,
    recoveryAction: '请检查错误详情或联系技术支持',
    recoveryIcon: '❓',
  };
}

/**
 * Check if an error is recoverable (transient and worth retrying).
 * This is a convenience wrapper around categorizeError.
 */
export function isRecoverable(message: string, status?: number): boolean {
  return categorizeError(message, status).recoverable;
}

/**
 * Get a user-friendly recovery action suggestion for an error.
 */
export function getRecoveryAction(message: string, status?: number): { action: string; icon: string } {
  const info = categorizeError(message, status);
  return { action: info.recoveryAction, icon: info.recoveryIcon };
}
