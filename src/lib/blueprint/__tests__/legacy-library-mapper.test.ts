// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from 'vitest';
import type {
  LibraryCharacterSnapshot,
  LibrarySceneSnapshot,
} from '../legacy-library-mapper';
import {
  buildCharacterPromptDescription,
  buildScenePromptDescription,
  resolveCharacterContext,
  resolveSceneContext,
} from '../legacy-library-mapper';

// ── Fixtures ──────────────────────────────────────────────────────────────

const mockCharacter: LibraryCharacterSnapshot = {
  id: 'char-1',
  name: '张三',
  description: '一位勇敢的战士',
  visualTraits: 'tall, muscular, scar on left cheek',
  gender: '男',
  age: '30',
  personality: '刚毅果敢',
  role: '主角',
  traits: '擅长剑术',
  appearance: '高大威猛，左脸有伤疤',
  tags: ['#武侠', '#男主'],
  notes: '第一集出场',
  thumbnailUrl: 'https://example.com/zhangsan.jpg',
};

const mockScene: LibrarySceneSnapshot = {
  id: 'scene-1',
  name: '山间竹林',
  location: '山间竹林深处',
  time: '黄昏',
  atmosphere: '静谧神秘',
  visualPrompt: 'A serene bamboo forest at dusk',
  referenceImage: 'https://example.com/bamboo.jpg',
  tags: ['#古风', '#自然'],
  notes: '第二集使用',
  architectureStyle: '中式古典',
  colorPalette: '暖色调',
  lightingDesign: '自然光',
  keyProps: ['竹子', '石板路'],
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('buildCharacterPromptDescription', () => {
  it('includes all available fields', () => {
    const desc = buildCharacterPromptDescription(mockCharacter);
    expect(desc).toContain('角色名: 张三');
    expect(desc).toContain('身份: 主角');
    expect(desc).toContain('性别: 男');
    expect(desc).toContain('年龄: 30');
    expect(desc).toContain('性格: 刚毅果敢');
    expect(desc).toContain('特质: 擅长剑术');
    expect(desc).toContain('外貌: 高大威猛');
    expect(desc).toContain('视觉特征: tall, muscular');
    expect(desc).toContain('描述: 一位勇敢的战士');
  });

  it('handles minimal character with only name', () => {
    const desc = buildCharacterPromptDescription({
      id: 'c1',
      name: '路人甲',
      description: '',
      visualTraits: '',
    });
    expect(desc).toBe('角色名: 路人甲');
  });

  it('returns empty string for empty character', () => {
    const desc = buildCharacterPromptDescription({
      id: 'c1',
      name: '',
      description: '',
      visualTraits: '',
    });
    expect(desc).toBe('');
  });
});

describe('buildScenePromptDescription', () => {
  it('includes all available fields', () => {
    const desc = buildScenePromptDescription(mockScene);
    expect(desc).toContain('场景: 山间竹林');
    expect(desc).toContain('地点: 山间竹林深处');
    expect(desc).toContain('时间: 黄昏');
    expect(desc).toContain('氛围: 静谧神秘');
    expect(desc).toContain('视觉描述: A serene bamboo forest');
    expect(desc).toContain('建筑风格: 中式古典');
    expect(desc).toContain('色彩基调: 暖色调');
    expect(desc).toContain('光影: 自然光');
    expect(desc).toContain('关键道具: 竹子、石板路');
  });

  it('handles minimal scene with only name', () => {
    const desc = buildScenePromptDescription({
      id: 's1',
      name: '教室',
      location: '',
      time: '',
      atmosphere: '',
    });
    expect(desc).toBe('场景: 教室');
  });

  it('returns empty string for empty scene', () => {
    const desc = buildScenePromptDescription({
      id: 's1',
      name: '',
      location: '',
      time: '',
      atmosphere: '',
    });
    expect(desc).toBe('');
  });
});

describe('resolveCharacterContext', () => {
  const libraryChars: LibraryCharacterSnapshot[] = [mockCharacter];

  it('resolves character by library ID', () => {
    const ctx = resolveCharacterContext(
      'script-char-1',
      '张三',
      'char-1',
      libraryChars,
    );

    expect(ctx.scriptCharacterId).toBe('script-char-1');
    expect(ctx.libraryCharacterId).toBe('char-1');
    expect(ctx.name).toBe('张三');
    expect(ctx.promptDescription).toContain('角色名: 张三');
    expect(ctx.visualTraits).toBe('tall, muscular, scar on left cheek');
    expect(ctx.referenceImageUrl).toBe('https://example.com/zhangsan.jpg');
    expect(ctx.tags).toEqual(['#武侠', '#男主']);
  });

  it('preserves library ID even when not found (for traceability)', () => {
    const ctx = resolveCharacterContext(
      'script-char-2',
      '张三',
      'nonexistent-id',
      libraryChars,
    );

    // The ID is preserved for traceability even though the character wasn't found
    expect(ctx.libraryCharacterId).toBe('nonexistent-id');
    expect(ctx.name).toBe('张三');
  });

  it('returns minimal context when no library match', () => {
    const ctx = resolveCharacterContext(
      'script-char-3',
      '王五',
      undefined,
      libraryChars,
    );

    expect(ctx.libraryCharacterId).toBeNull();
    expect(ctx.name).toBe('王五');
    expect(ctx.promptDescription).toBe('角色名: 王五');
    expect(ctx.visualTraits).toBe('');
    expect(ctx.referenceImageUrl).toBeNull();
  });

  it('resolves by name when libraryCharId is undefined', () => {
    const ctx = resolveCharacterContext(
      'script-char-4',
      '张三',
      undefined,
      libraryChars,
    );

    // Name matching should find '张三' in the library
    expect(ctx.libraryCharacterId).toBe('char-1');
    expect(ctx.visualTraits).toBe('tall, muscular, scar on left cheek');
  });
});

describe('resolveSceneContext', () => {
  const libraryScenes: LibrarySceneSnapshot[] = [mockScene];

  it('resolves scene by library ID', () => {
    const ctx = resolveSceneContext(
      'script-scene-1',
      '山间竹林',
      'scene-1',
      libraryScenes,
    );

    expect(ctx.scriptSceneId).toBe('script-scene-1');
    expect(ctx.librarySceneId).toBe('scene-1');
    expect(ctx.name).toBe('山间竹林');
    expect(ctx.promptDescription).toContain('场景: 山间竹林');
    expect(ctx.location).toBe('山间竹林深处');
    expect(ctx.time).toBe('黄昏');
    expect(ctx.atmosphere).toBe('静谧神秘');
    expect(ctx.referenceImageUrl).toBe('https://example.com/bamboo.jpg');
    expect(ctx.tags).toEqual(['#古风', '#自然']);
  });

  it('returns minimal context when no library match', () => {
    const ctx = resolveSceneContext(
      'script-scene-2',
      '教室',
      undefined,
      libraryScenes,
    );

    expect(ctx.librarySceneId).toBeNull();
    expect(ctx.name).toBe('教室');
    expect(ctx.promptDescription).toBe('场景: 教室');
    expect(ctx.location).toBe('');
  });

  it('handles undefined scene name', () => {
    const ctx = resolveSceneContext(
      'script-scene-3',
      undefined,
      undefined,
      libraryScenes,
    );

    expect(ctx.librarySceneId).toBeNull();
    expect(ctx.name).toBe('');
    expect(ctx.promptDescription).toBe('');
  });
});
