import { describe, expect, it } from 'vitest';
import { resolveRequestModel, resolveSupportedModelFromError } from '../request-model-resolver';

describe('request model resolver', () => {
  it('normalizes DeepSeek V4 catalogue version names', () => {
    expect(resolveRequestModel('DeepSeek-V4-Flash-0731')).toBe('deepseek-v4-flash');
    expect(resolveRequestModel('DeepSeek_V4_Pro_20260731')).toBe('deepseek-v4-pro');
  });

  it('keeps unknown versioned model IDs unchanged', () => {
    expect(resolveRequestModel('custom-model-2026-07-31')).toBe('custom-model-2026-07-31');
  });

  it('selects the matching canonical model advertised by an API error', () => {
    const error = '{"error":{"message":"The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed DeepSeek-V4-Flash-0731."}}';
    expect(resolveSupportedModelFromError(error, 'DeepSeek-V4-Flash-0731')).toBe('deepseek-v4-flash');
  });

  it('does not choose an unrelated advertised model', () => {
    expect(resolveSupportedModelFromError('The supported API model names are gpt-5 or gpt-5-mini, but you passed claude-4.', 'claude-4')).toBeNull();
  });
});