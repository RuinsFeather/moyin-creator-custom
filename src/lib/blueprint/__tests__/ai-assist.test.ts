// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAIResponse, requestAIAssist, type AIAssistRequest } from '../ai-assist';

// Mock dependencies
vi.mock('@/lib/script/script-parser', () => ({
  callChatAPI: vi.fn(),
}));

vi.mock('@/lib/ai/feature-router', () => ({
  getFeatureConfig: vi.fn(),
}));

import { callChatAPI } from '@/lib/script/script-parser';
import { getFeatureConfig } from '@/lib/ai/feature-router';

const mockCallChatAPI = vi.mocked(callChatAPI);
const mockGetFeatureConfig = vi.mocked(getFeatureConfig);

describe('parseAIResponse', () => {
  it('extracts proposed text between markers', () => {
    const raw = '我优化了提示词。\n[TEXT_START]\n一个美丽的女孩站在樱花树下\n[TEXT_END]';
    const result = parseAIResponse(raw);
    expect(result.proposedText).toBe('一个美丽的女孩站在樱花树下');
    expect(result.response).toBe('我优化了提示词。');
  });

  it('handles markers with surrounding text', () => {
    const raw = '修改说明\n[TEXT_START]\n新文本内容\n[TEXT_END]\n附加说明';
    const result = parseAIResponse(raw);
    expect(result.proposedText).toBe('新文本内容');
    expect(result.response).toContain('修改说明');
    expect(result.response).toContain('附加说明');
  });

  it('returns full response when no markers present', () => {
    const raw = '这是一段普通回复，没有修改建议。';
    const result = parseAIResponse(raw);
    expect(result.proposedText).toBeUndefined();
    expect(result.response).toBe('这是一段普通回复，没有修改建议。');
  });

  it('handles empty proposed text', () => {
    const raw = '没有修改。\n[TEXT_START]\n\n[TEXT_END]';
    const result = parseAIResponse(raw);
    expect(result.proposedText).toBe('');
  });

  it('handles markers in wrong order gracefully', () => {
    const raw = '[TEXT_END]\n文本\n[TEXT_START]';
    const result = parseAIResponse(raw);
    expect(result.proposedText).toBeUndefined();
    expect(result.response).toContain('TEXT_END');
  });

  it('handles multi-line proposed text', () => {
    const raw = '[TEXT_START]\n第一行\n第二行\n第三行\n[TEXT_END]';
    const result = parseAIResponse(raw);
    expect(result.proposedText).toBe('第一行\n第二行\n第三行');
  });

  it('trims whitespace from proposed text', () => {
    const raw = '[TEXT_START]\n  有空格的文本  \n[TEXT_END]';
    const result = parseAIResponse(raw);
    expect(result.proposedText).toBe('有空格的文本');
  });

  it('returns default response when only markers with no surrounding text', () => {
    const raw = '[TEXT_START]\n修改后的文本\n[TEXT_END]';
    const result = parseAIResponse(raw);
    expect(result.proposedText).toBe('修改后的文本');
    expect(result.response).toBe('已为您修改文本');
  });
});

describe('requestAIAssist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when chat feature not configured', async () => {
    mockGetFeatureConfig.mockReturnValue(null);

    const req: AIAssistRequest = {
      currentText: '测试文本',
      userInstruction: '优化',
    };

    await expect(requestAIAssist(req)).rejects.toThrow('请先在设置中配置');
  });

  it('calls callChatAPI with correct parameters', async () => {
    mockGetFeatureConfig.mockReturnValue({
      feature: 'chat',
      featureName: '通用对话',
      provider: 'memefast' as any,
      apiKey: 'test-key',
      allApiKeys: ['test-key'],
      keyManager: {} as any,
      platform: 'memefast',
      baseUrl: 'https://api.example.com',
      models: ['gpt-4'],
      model: 'gpt-4',
    });

    mockCallChatAPI.mockResolvedValue('[TEXT_START]\n优化后的文本\n[TEXT_END]');

    const req: AIAssistRequest = {
      currentText: '原始文本',
      userInstruction: '帮我优化',
      role: 'prompt',
      language: 'zh',
    };

    const result = await requestAIAssist(req);

    expect(mockCallChatAPI).toHaveBeenCalledTimes(1);
    const [systemPrompt, userPrompt, options] = mockCallChatAPI.mock.calls[0];
    expect(systemPrompt).toContain('提示词');
    expect(userPrompt).toContain('原始文本');
    expect(userPrompt).toContain('帮我优化');
    expect(options.apiKey).toBe('test-key');
    expect(options.model).toBe('gpt-4');
    expect(result.proposedText).toBe('优化后的文本');
  });

  it('passes history context to the API', async () => {
    mockGetFeatureConfig.mockReturnValue({
      feature: 'chat',
      featureName: '通用对话',
      provider: 'memefast' as any,
      apiKey: 'test-key',
      allApiKeys: ['test-key'],
      keyManager: {} as any,
      platform: 'memefast',
      baseUrl: 'https://api.example.com',
      models: ['gpt-4'],
      model: 'gpt-4',
    });

    mockCallChatAPI.mockResolvedValue('普通回复');

    const req: AIAssistRequest = {
      currentText: '文本',
      userInstruction: '继续优化',
      history: [
        { id: '1', role: 'user', content: '第一次请求', timestamp: 1 },
        { id: '2', role: 'assistant', content: '第一次回复', timestamp: 2 },
      ],
    };

    await requestAIAssist(req);

    expect(mockCallChatAPI).toHaveBeenCalledTimes(1);
  });

  it('uses default role and language when not specified', async () => {
    mockGetFeatureConfig.mockReturnValue({
      feature: 'chat',
      featureName: '通用对话',
      provider: 'memefast' as any,
      apiKey: 'key',
      allApiKeys: ['key'],
      keyManager: {} as any,
      platform: 'memefast',
      baseUrl: 'https://api.example.com',
      models: ['gpt-4'],
      model: 'gpt-4',
    });

    mockCallChatAPI.mockResolvedValue('回复');

    await requestAIAssist({
      currentText: '',
      userInstruction: '你好',
    });

    const [systemPrompt] = mockCallChatAPI.mock.calls[0];
    expect(systemPrompt).toContain('提示词'); // default role is 'prompt'
  });

  it('handles API errors gracefully', async () => {
    mockGetFeatureConfig.mockReturnValue({
      feature: 'chat',
      featureName: '通用对话',
      provider: 'memefast' as any,
      apiKey: 'key',
      allApiKeys: ['key'],
      keyManager: {} as any,
      platform: 'memefast',
      baseUrl: 'https://api.example.com',
      models: ['gpt-4'],
      model: 'gpt-4',
    });

    mockCallChatAPI.mockRejectedValue(new Error('API rate limit exceeded'));

    await expect(
      requestAIAssist({ currentText: 'text', userInstruction: 'do something' }),
    ).rejects.toThrow('API rate limit exceeded');
  });
});
