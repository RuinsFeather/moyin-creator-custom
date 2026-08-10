// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, it, expect } from 'vitest';
import {
  sanitizeErrorMessage,
  categorizeError,
  isRecoverable,
  getRecoveryAction,
} from '../error-utils';

describe('sanitizeErrorMessage', () => {
  it('strips API key in query parameter', () => {
    const input =
      'Request failed: https://api.example.com/v1/generate?key=sk-abcdefghijklmnopqrstuvwxyz1234567890';
    const result = sanitizeErrorMessage(input);
    expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(result).toContain('***');
  });

  it('strips Bearer token', () => {
    const input = 'Auth failed: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = sanitizeErrorMessage(input);
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(result).toContain('Bearer ***');
  });

  it('strips Authorization header value', () => {
    const input = 'Error: Authorization: Bearer abcdefghijklmnopqrstuvwxyz';
    const result = sanitizeErrorMessage(input);
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(result).toContain('Authorization: ***');
  });

  it('strips sk- prefixed keys', () => {
    const input = 'Invalid key sk-1234567890abcdefghijklmnop provided';
    const result = sanitizeErrorMessage(input);
    expect(result).not.toContain('sk-1234567890abcdefghijklmnop');
  });

  it('strips ghp_ prefixed tokens', () => {
    const input = 'Token ghp_abcdefghijklmnopqrstuvwxyz123456 is invalid';
    const result = sanitizeErrorMessage(input);
    expect(result).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
  });

  it('strips long hex strings', () => {
    const input = 'Token a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1 expired';
    const result = sanitizeErrorMessage(input);
    expect(result).not.toContain('a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1');
  });

  it('strips embedded credentials in URL', () => {
    const input = 'Failed to connect to https://user:secretpass@api.example.com/data';
    const result = sanitizeErrorMessage(input);
    expect(result).not.toContain('secretpass');
    expect(result).toContain('***@api.example.com');
  });

  it('preserves normal error messages', () => {
    const input = 'Network timeout after 30 seconds';
    const result = sanitizeErrorMessage(input);
    expect(result).toBe(input);
  });

  it('handles empty string', () => {
    expect(sanitizeErrorMessage('')).toBe('');
  });
});

describe('categorizeError', () => {
  it('categorizes network errors as recoverable', () => {
    const info = categorizeError('ECONNREFUSED: connect failed');
    expect(info.category).toBe('network');
    expect(info.recoverable).toBe(true);
    expect(info.recoveryAction).toBeTruthy();
  });

  it('categorizes timeout as network', () => {
    const info = categorizeError('ETIMEDOUT: connection timed out');
    expect(info.category).toBe('network');
    expect(info.recoverable).toBe(true);
  });

  it('categorizes fetch failed as network', () => {
    const info = categorizeError('fetch failed');
    expect(info.category).toBe('network');
    expect(info.recoverable).toBe(true);
  });

  it('categorizes DNS error as network', () => {
    const info = categorizeError('ENOTFOUND: getaddrinfo failed');
    expect(info.category).toBe('network');
    expect(info.recoverable).toBe(true);
  });

  it('categorizes 401 as auth (not recoverable)', () => {
    const info = categorizeError('Unauthorized', 401);
    expect(info.category).toBe('auth');
    expect(info.recoverable).toBe(false);
    expect(info.recoveryAction).toBeTruthy();
  });

  it('categorizes 403 as auth', () => {
    const info = categorizeError('Forbidden', 403);
    expect(info.category).toBe('auth');
    expect(info.recoverable).toBe(false);
  });

  it('categorizes invalid key as auth', () => {
    const info = categorizeError('Invalid API key provided');
    expect(info.category).toBe('auth');
    expect(info.recoverable).toBe(false);
  });

  it('categorizes 429 as api (rate limit)', () => {
    const info = categorizeError('Too many requests', 429);
    expect(info.category).toBe('api');
    expect(info.recoverable).toBe(true);
    expect(info.recoveryAction).toContain('频繁');
  });

  it('categorizes cancelled as recoverable (can re-run)', () => {
    const info = categorizeError('Request was cancelled');
    expect(info.category).toBe('cancelled');
    expect(info.recoverable).toBe(true);
  });

  it('categorizes 上游节点失败 as blocked (not recoverable)', () => {
    const info = categorizeError('上游节点执行失败');
    expect(info.category).toBe('blocked');
    expect(info.recoverable).toBe(false);
  });

  it('categorizes 500 as api (retryable)', () => {
    const info = categorizeError('Internal server error', 500);
    expect(info.category).toBe('api');
    expect(info.recoverable).toBe(true);
  });

  it('returns unknown for generic errors', () => {
    const info = categorizeError('Something went wrong');
    expect(info.category).toBe('unknown');
    expect(info.recoverable).toBe(false);
  });
});

describe('isRecoverable', () => {
  it('returns true for network errors', () => {
    expect(isRecoverable('ECONNRESET: connection reset')).toBe(true);
  });

  it('returns false for auth errors', () => {
    expect(isRecoverable('unauthorized', 401)).toBe(false);
  });
});

describe('getRecoveryAction', () => {
  it('returns network recovery action for network errors', () => {
    const action = getRecoveryAction('ECONNREFUSED');
    expect(action.action).toBeTruthy();
    expect(action.icon).toBeTruthy();
  });

  it('returns auth recovery action for auth errors', () => {
    const action = getRecoveryAction('Invalid API key');
    expect(action.action).toBeTruthy();
    expect(action.icon).toBeTruthy();
  });

  it('returns generic recovery action for unknown errors', () => {
    const action = getRecoveryAction('Random error');
    expect(action.action).toBeTruthy();
    expect(action.icon).toBeTruthy();
  });
});
