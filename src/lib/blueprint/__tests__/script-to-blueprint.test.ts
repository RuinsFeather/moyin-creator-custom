// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from 'vitest';
import type { Shot } from '@/types/script';
import {
  convertScriptToBlueprint,
  previewScriptToBlueprint,
} from '../script-to-blueprint';
import type { ConvertScriptToBlueprintOptions } from '../script-to-blueprint';
import { BLUEPRINT_SCHEMA_VERSION } from '@/types/blueprint';

// ── Test fixtures ───────────────────────────────────────────────────────────

function makeShot(overrides: Partial<Shot> & { index: number }): Shot {
  return {
    id: overrides.id ?? `shot-${overrides.index}`,
    index: overrides.index,
    episodeId: overrides.episodeId ?? '',
    sceneRefId: overrides.sceneRefId ?? '',
    characterIds: overrides.characterIds ?? [],
    characterNames: overrides.characterNames,
    dialogue: overrides.dialogue,
    actionSummary: overrides.actionSummary ?? `Shot ${overrides.index} action`,
    visualDescription: overrides.visualDescription,
    visualPrompt: overrides.visualPrompt,
    imagePrompt: overrides.imagePrompt,
    videoPrompt: overrides.videoPrompt,
    characterVariations: overrides.characterVariations ?? {},
    imageStatus: overrides.imageStatus ?? 'idle',
    imageProgress: overrides.imageProgress ?? 0,
    videoStatus: overrides.videoStatus ?? 'idle',
    videoProgress: overrides.videoProgress ?? 0,
  };
}

function makeOptions(overrides: Partial<ConvertScriptToBlueprintOptions> = {}): ConvertScriptToBlueprintOptions {
  return {
    projectId: 'test-project',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('convertScriptToBlueprint - diagnostics', () => {
  it('generates warning for shots without prompts', () => {
    const shots = [
      makeShot({ index: 0, imagePrompt: undefined, visualPrompt: undefined, visualDescription: undefined, actionSummary: '' }),
    ];

    const result = convertScriptToBlueprint(makeOptions({ shots }));
    const warnings = result.diagnostics.filter((d) => d.code === 'shot-missing-prompt');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].message).toContain('没有可用的提示词');
  });

  it('generates info for shots with character IDs but no names', () => {
    const shots = [
      makeShot({
        index: 0,
        characterIds: ['char-1'],
        characterNames: undefined,
        imagePrompt: 'prompt',
      }),
    ];

    const result = convertScriptToBlueprint(makeOptions({ shots }));
    const infos = result.diagnostics.filter((d) => d.code === 'shot-missing-character-names');
    expect(infos).toHaveLength(1);
    expect(infos[0].severity).toBe('info');
  });

  it('returns empty diagnostics for well-formed shots', () => {
    const shots = [
      makeShot({
        index: 0,
        imagePrompt: 'A beautiful sunset',
        characterNames: ['张三'],
      }),
    ];

    const result = convertScriptToBlueprint(makeOptions({ shots }));
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe('convertScriptToBlueprint - Markdown parsing', () => {
  it('parses rawScript when shots are not provided', () => {
    const rawScript = `# 剧本

## 场景1：外景 - 公园

阳光明媚的公园。`;

    const result = convertScriptToBlueprint(makeOptions({ rawScript }));
    expect(result.shotCount).toBeGreaterThanOrEqual(1);
    expect(result.blueprint.nodes.length).toBeGreaterThan(0);
  });

  it('uses shots directly when both shots and rawScript are provided', () => {
    const shots = [
      makeShot({ index: 0, imagePrompt: 'shot prompt' }),
    ];
    const rawScript = `## 场景1\n\n其他内容。`;

    const result = convertScriptToBlueprint(makeOptions({ shots, rawScript }));
    expect(result.shotCount).toBe(1);
  });

  it('uses scriptProjectData.shots when shots option is omitted', () => {
    const scriptProjectData = {
      shots: [makeShot({ index: 0, imagePrompt: 'prompt' })],
      updatedAt: 1000,
    };

    const result = convertScriptToBlueprint(makeOptions({ scriptProjectData }));
    expect(result.shotCount).toBe(1);
  });

  it('falls back to parsing scriptProjectData.rawScript when scriptProjectData.shots is empty', () => {
    const scriptProjectData = {
      shots: [],
      rawScript: `## 场景1\n\n内容。`,
      updatedAt: 1000,
    };

    const result = convertScriptToBlueprint(makeOptions({ scriptProjectData }));
    expect(result.shotCount).toBeGreaterThanOrEqual(1);
  });
});

describe('convertScriptToBlueprint - sourceVersion', () => {
  it('sets sourceVersion from scriptProjectData.updatedAt', () => {
    const shots = [
      makeShot({ index: 0, imagePrompt: 'prompt' }),
    ];
    const scriptProjectData = {
      shots,
      updatedAt: 12345,
    };

    const result = convertScriptToBlueprint(makeOptions({ shots, scriptProjectData }));
    const shotNode = result.blueprint.nodes.find(
      (n) => n.data.sourceRef?.kind === 'shot',
    );
    expect(shotNode?.data.sourceRef?.sourceVersion).toBe('12345');
  });

  it('sets sourceVersion from rawScript length when no updatedAt', () => {
    const rawScript = `## 场景1\n\n内容。`;
    const result = convertScriptToBlueprint(makeOptions({ rawScript }));
    const shotNode = result.blueprint.nodes.find(
      (n) => n.data.sourceRef?.kind === 'shot',
    );
    expect(shotNode?.data.sourceRef?.sourceVersion).toBe(String(rawScript.length));
  });

  it('sets sourceVersion to undefined when no scriptProjectData or rawScript', () => {
    const shots = [
      makeShot({ index: 0, imagePrompt: 'prompt' }),
    ];

    const result = convertScriptToBlueprint(makeOptions({ shots }));
    const shotNode = result.blueprint.nodes.find(
      (n) => n.data.sourceRef?.kind === 'shot',
    );
    expect(shotNode?.data.sourceRef?.sourceVersion).toBeUndefined();
  });
});

describe('convertScriptToBlueprint - selectedShotIds', () => {
  it('filters shots by selectedShotIds', () => {
    const shots = [
      makeShot({ index: 0, id: 'a', imagePrompt: 'prompt a' }),
      makeShot({ index: 1, id: 'b', imagePrompt: 'prompt b' }),
      makeShot({ index: 2, id: 'c', imagePrompt: 'prompt c' }),
    ];

    const result = convertScriptToBlueprint(makeOptions({ shots, selectedShotIds: ['a', 'c'] }));
    expect(result.includedShotIds).toEqual(['a', 'c']);
    expect(result.shotCount).toBe(2);
  });

  it('includes all shots when selectedShotIds is empty', () => {
    const shots = [
      makeShot({ index: 0, imagePrompt: 'prompt' }),
    ];

    const result = convertScriptToBlueprint(makeOptions({ shots, selectedShotIds: [] }));
    expect(result.shotCount).toBe(1);
  });
});

describe('previewScriptToBlueprint', () => {
  it('returns preview with diagnostics', () => {
    const shots = [
      makeShot({ index: 0, imagePrompt: 'prompt' }),
      makeShot({ index: 1, imagePrompt: undefined, visualPrompt: undefined, visualDescription: undefined, actionSummary: '' }),
    ];

    const result = previewScriptToBlueprint(makeOptions({ shots }));
    expect(result.shotCount).toBe(2);
    expect(result.hasPrompts).toBe(1);
    expect(result.missingPrompts).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('shot-missing-prompt');
  });

  it('handles rawScript for preview', () => {
    const rawScript = `## 场景1\n\n内容。`;
    const result = previewScriptToBlueprint(makeOptions({ rawScript }));
    expect(result.shotCount).toBeGreaterThanOrEqual(1);
  });

  it('handles scriptProjectData for preview', () => {
    const scriptProjectData = {
      shots: [makeShot({ index: 0, imagePrompt: 'prompt' })],
    };

    const result = previewScriptToBlueprint(makeOptions({ scriptProjectData }));
    expect(result.shotCount).toBe(1);
  });
});

describe('convertScriptToBlueprint - backward compatibility', () => {
  it('produces a valid blueprint with the original shots-based API', () => {
    const shots = [
      makeShot({ index: 0, imagePrompt: 'A sunset over mountains' }),
    ];

    const result = convertScriptToBlueprint(makeOptions({ shots }));
    expect(result.blueprint.version).toBe(BLUEPRINT_SCHEMA_VERSION);
    expect(result.blueprint.projectId).toBe('test-project');
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.edgeCount).toBeGreaterThanOrEqual(0);
  });

  it('script-import node has sourceRef.kind = shot', () => {
    const shots = [
      makeShot({ index: 0, imagePrompt: 'prompt' }),
    ];

    const result = convertScriptToBlueprint(makeOptions({ shots }));
    const scriptNode = result.blueprint.nodes.find((n) => n.type === 'script-import');
    expect(scriptNode?.data.sourceRef?.kind).toBe('shot');
  });

  it('script-import node stores shot ID in sourceRef', () => {
    const shots = [
      makeShot({
        index: 0,
        id: 'my-shot-id',
        imagePrompt: 'prompt',
        characterNames: ['张三', '李四'],
      }),
    ];

    const result = convertScriptToBlueprint(makeOptions({ shots }));
    const scriptNode = result.blueprint.nodes.find((n) => n.type === 'script-import');
    expect(scriptNode?.data.sourceRef?.id).toBe('my-shot-id');
  });
});
