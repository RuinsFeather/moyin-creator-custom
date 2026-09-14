import { describe, expect, it } from 'vitest';
import { isSeedanceModel, resolveSeedanceCapability } from '../seedance-capability';
import { buildVolcVideoSubmitPath } from '../volc-video-endpoint';

describe('Volc Seedance video endpoint', () => {
  it.each([
    'seedance-2.0',
    'seedance-2.5',
    'doubao-seedance-2-0-260128',
  ])('routes %s through the same default official task API', (model) => {
    expect(isSeedanceModel(model)).toBe(true);
    expect(resolveSeedanceCapability(model).structuredParameters).toBe(true);
    expect(buildVolcVideoSubmitPath('https://ark.cn-beijing.volces.com/api/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
    );
  });

  it('defaults to the official api/v3 channel for every provider', () => {
    expect(buildVolcVideoSubmitPath('https://ark.cn-beijing.volces.com/api/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
    );
    expect(buildVolcVideoSubmitPath('https://memefast.top/v1')).toBe(
      'https://memefast.top/api/v3/contents/generations/tasks',
    );
  });

  it('switches the same provider to the v1 video task channel', () => {
    expect(buildVolcVideoSubmitPath(
      'https://api.example.com/v1',
      'v1/video/generations/tasks',
    )).toBe('https://api.example.com/v1/video/generations/tasks');
    expect(buildVolcVideoSubmitPath(
      'https://ark.cn-beijing.volces.com/api/v3',
      'v1/video/generations/tasks',
    )).toBe('https://ark.cn-beijing.volces.com/v1/video/generations/tasks');
  });

  it('replaces a previously configured complete task path with the selected channel', () => {
    expect(buildVolcVideoSubmitPath(
      'https://api.example.com/v1/video/generations/tasks',
      'api/v3/contents/generations/tasks',
    )).toBe(
      'https://api.example.com/api/v3/contents/generations/tasks',
    );
  });

  it('does not infer a special channel from localhost or provider domains', () => {
    expect(buildVolcVideoSubmitPath(
      'http://localhost:8080',
      'v1/video/generations/tasks',
    )).toBe('http://localhost:8080/v1/video/generations/tasks');
  });
});