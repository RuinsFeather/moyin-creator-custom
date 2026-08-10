// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from 'vitest';
import {
  parseMarkdownScript,
  extractDialogue,
  extractShotInstructions,
  scenesToShots,
} from '../markdown-script-parser';

describe('markdown-script-parser', () => {
  describe('parseMarkdownScript', () => {
    it('parses explicit scene headings', () => {
      const md = `## 场景1：外景 - 城市街道

一个繁华的城市街道。

## 场景2：内景 - 咖啡馆

安静的咖啡馆内景。`;

      const result = parseMarkdownScript(md);
      expect(result.scenes).toHaveLength(2);
      expect(result.scenes[0].heading).toBe('外景 - 城市街道');
      expect(result.scenes[1].heading).toBe('内景 - 咖啡馆');
    });

    it('parses scene markers with Chinese numbering', () => {
      const md = `## 第一幕

开场。

## 第二场

发展。`;

      const result = parseMarkdownScript(md);
      expect(result.scenes).toHaveLength(2);
      expect(result.scenes[0].heading).toBe('第一幕');
      expect(result.scenes[1].heading).toBe('第二场');
    });

    it('parses English scene markers', () => {
      const md = `## Scene 1: EXT. STREET - DAY

A busy street.

## Scene 2: INT. CAFE - NIGHT

A quiet cafe.`;

      const result = parseMarkdownScript(md);
      expect(result.scenes).toHaveLength(2);
      expect(result.scenes[0].heading).toContain('STREET');
    });

    it('creates a single scene when no headings found', () => {
      const md = `这是一段没有标题的剧本内容。

包含多个段落。`;

      const result = parseMarkdownScript(md);
      expect(result.scenes).toHaveLength(1);
      expect(result.scenes[0].heading).toBe('剧本');
    });

    it('extracts character names from dialogue', () => {
      const md = `## 场景1

**张三**：你好，今天天气不错。

**李四**：是啊，适合出去走走。

【旁白】：两人走在街上。`;

      const result = parseMarkdownScript(md);
      expect(result.characters).toContain('张三');
      expect(result.characters).toContain('李四');
      expect(result.characters).toContain('旁白');
    });

    it('returns empty for empty input', () => {
      const result = parseMarkdownScript('');
      expect(result.scenes).toHaveLength(0);
      expect(result.characters).toHaveLength(0);
    });

    it('tracks line numbers correctly', () => {
      const md = `第一行

## 场景1

内容行1
内容行2`;

      const result = parseMarkdownScript(md);
      expect(result.scenes).toHaveLength(1);
      expect(result.scenes[0].startLine).toBe(3);
      expect(result.totalLines).toBe(6);
    });
  });

  describe('extractDialogue', () => {
    it('extracts dialogue with bold markers', () => {
      const content = `**张三**：你好！
一些描述。
**李四**：再见！`;

      const dialogues = extractDialogue(content);
      expect(dialogues).toHaveLength(2);
      expect(dialogues[0]).toEqual({
        characterName: '张三',
        text: '你好！',
        line: 1,
      });
      expect(dialogues[1]).toEqual({
        characterName: '李四',
        text: '再见！',
        line: 3,
      });
    });

    it('extracts dialogue with bracket markers', () => {
      const content = `【旁白】：故事开始了。
【解说员】：在很久以前。`;

      const dialogues = extractDialogue(content);
      expect(dialogues).toHaveLength(2);
      expect(dialogues[0].characterName).toBe('旁白');
      expect(dialogues[1].characterName).toBe('解说员');
    });

    it('returns empty for content without dialogue', () => {
      const dialogues = extractDialogue('这是一段没有对话的内容。');
      expect(dialogues).toHaveLength(0);
    });
  });

  describe('extractShotInstructions', () => {
    it('extracts shot size instructions', () => {
      const text = '【景别：近景】人物特写。';
      const instructions = extractShotInstructions(text);
      expect(instructions).toHaveLength(1);
      expect(instructions[0].type).toBe('shot-size');
      expect(instructions[0].value).toBe('Close-up');
    });

    it('extracts camera movement instructions', () => {
      const text = '【镜头运动：推】缓慢推进。';
      const instructions = extractShotInstructions(text);
      expect(instructions).toHaveLength(1);
      expect(instructions[0].type).toBe('camera-movement');
      expect(instructions[0].value).toBe('Dolly In');
    });

    it('extracts duration instructions', () => {
      const text = '【时长：3秒】';
      const instructions = extractShotInstructions(text);
      expect(instructions).toHaveLength(1);
      expect(instructions[0].type).toBe('duration');
    });

    it('extracts multiple instructions', () => {
      const text = '【景别：远景】【镜头运动：固定】【时长：5秒】';
      const instructions = extractShotInstructions(text);
      expect(instructions).toHaveLength(3);
    });

    it('returns empty for text without instructions', () => {
      const instructions = extractShotInstructions('普通文本内容');
      expect(instructions).toHaveLength(0);
    });
  });

  describe('scenesToShots', () => {
    it('converts scenes without dialogue to single shots', () => {
      const parseResult = {
        scenes: [
          {
            id: 'scene-1',
            heading: '场景1',
            level: 2,
            content: '一个安静的夜晚。',
            startLine: 1,
            endLine: 3,
          },
        ],
        characters: [],
        totalLines: 3,
      };

      const shots = scenesToShots(parseResult);
      expect(shots).toHaveLength(1);
      expect(shots[0].actionSummary).toBe('一个安静的夜晚。');
      expect(shots[0].sceneRefId).toBe('scene-1');
    });

    it('converts scenes with dialogue to multiple shots', () => {
      const parseResult = {
        scenes: [
          {
            id: 'scene-1',
            heading: '对话场景',
            level: 2,
            content: '**张三**：你好！\n**李四**：再见！',
            startLine: 1,
            endLine: 2,
          },
        ],
        characters: ['张三', '李四'],
        totalLines: 2,
      };

      const shots = scenesToShots(parseResult);
      expect(shots).toHaveLength(2);
      expect(shots[0].characterNames).toContain('张三');
      expect(shots[1].characterNames).toContain('李四');
    });

    it('sets episodeId when provided', () => {
      const parseResult = {
        scenes: [
          {
            id: 'scene-1',
            heading: '场景1',
            level: 2,
            content: '内容',
            startLine: 1,
            endLine: 1,
          },
        ],
        characters: [],
        totalLines: 1,
      };

      const shots = scenesToShots(parseResult, 'ep-1');
      expect(shots[0].episodeId).toBe('ep-1');
    });

    it('generates unique shot IDs', () => {
      const parseResult = {
        scenes: [
          {
            id: 'scene-1',
            heading: '场景1',
            level: 2,
            content: '**A**：1\n**B**：2',
            startLine: 1,
            endLine: 2,
          },
        ],
        characters: ['A', 'B'],
        totalLines: 2,
      };

      const shots = scenesToShots(parseResult);
      expect(shots[0].id).not.toBe(shots[1].id);
    });

    it('caps action summary length', () => {
      const longText = 'A'.repeat(1000);
      const parseResult = {
        scenes: [
          {
            id: 'scene-1',
            heading: '场景1',
            level: 2,
            content: longText,
            startLine: 1,
            endLine: 1,
          },
        ],
        characters: [],
        totalLines: 1,
      };

      const shots = scenesToShots(parseResult);
      expect(shots[0].actionSummary.length).toBeLessThanOrEqual(500);
    });

    it('returns empty for empty scenes', () => {
      const shots = scenesToShots({ scenes: [], characters: [], totalLines: 0 });
      expect(shots).toHaveLength(0);
    });
  });
});
