// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from 'vitest';
import type { DirectorSceneData } from '../director-to-blueprint';
import {
  convertDirectorToBlueprint,
  previewDirectorToBlueprint,
} from '../director-to-blueprint';

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeScene(index: number, overrides: Partial<DirectorSceneData> = {}): DirectorSceneData {
  return {
    id: index,
    sceneName: `场景 ${index + 1}`,
    sceneLocation: `地点 ${index + 1}`,
    imagePrompt: `A beautiful scene ${index + 1}`,
    imagePromptZh: `美丽的场景 ${index + 1}`,
    videoPrompt: `Camera slowly moves through scene ${index + 1}`,
    videoPromptZh: `镜头缓慢移动穿越场景 ${index + 1}`,
    dialogue: '',
    actionSummary: '',
    shotSize: '中景',
    duration: '5s',
    characterIds: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('convertDirectorToBlueprint', () => {
  it('converts scenes to blueprint with correct node counts', () => {
    const scenes = [makeScene(0), makeScene(1)];
    const result = convertDirectorToBlueprint({
      projectId: 'test-project',
      scenes,
    });

    expect(result.sceneCount).toBe(2);
    expect(result.nodeCount).toBe(8); // 4 nodes per scene
    expect(result.edgeCount).toBe(6); // 3 edges per scene
    expect(result.includedSceneIds).toEqual([0, 1]);
  });

  it('creates blueprint with correct project ID', () => {
    const scenes = [makeScene(0)];
    const result = convertDirectorToBlueprint({
      projectId: 'my-project',
      scenes,
    });

    expect(result.blueprint.projectId).toBe('my-project');
    expect(result.blueprint.status).toBe('draft');
  });

  it('uses provided name', () => {
    const scenes = [makeScene(0)];
    const result = convertDirectorToBlueprint({
      projectId: 'test',
      scenes,
      name: '我的 Director 蓝图',
    });

    expect(result.blueprint.name).toBe('我的 Director 蓝图');
  });

  it('uses existing blueprint ID when provided', () => {
    const scenes = [makeScene(0)];
    const result = convertDirectorToBlueprint({
      projectId: 'test',
      scenes,
      existingBlueprintId: 'existing-id-123',
    });

    expect(result.blueprint.id).toBe('existing-id-123');
  });

  it('filters scenes by selectedSceneIds', () => {
    const scenes = [makeScene(0), makeScene(1), makeScene(2)];
    const result = convertDirectorToBlueprint({
      projectId: 'test',
      scenes,
      selectedSceneIds: [0, 2],
    });

    expect(result.sceneCount).toBe(2);
    expect(result.includedSceneIds).toEqual([0, 2]);
  });

  it('creates director-scene sourceRef on all nodes', () => {
    const scenes = [makeScene(0)];
    const result = convertDirectorToBlueprint({
      projectId: 'test',
      scenes,
      sourceVersion: '20260101',
    });

    for (const node of result.blueprint.nodes) {
      expect(node.data.sourceRef).toBeDefined();
      expect(node.data.sourceRef!.kind).toBe('director-scene');
      expect(node.data.sourceRef!.id).toBe('0');
      expect(node.data.sourceRef!.sourceVersion).toBe('20260101');
    }
  });

  it('uses Chinese prompt when available', () => {
    const scenes = [makeScene(0, {
      imagePromptZh: '中文提示词',
      imagePrompt: 'English prompt',
    })];
    const result = convertDirectorToBlueprint({
      projectId: 'test',
      scenes,
    });

    // The text-input node should use the Chinese prompt
    const textNode = result.blueprint.nodes.find(
      (n) => n.data.nodeType === 'text-input',
    );
    expect(textNode).toBeDefined();
    expect((textNode!.data.config as { text: string }).text).toBe('中文提示词');
  });

  it('falls back to English prompt when Chinese is empty', () => {
    const scenes = [makeScene(0, {
      imagePromptZh: '',
      imagePrompt: 'English prompt',
    })];
    const result = convertDirectorToBlueprint({
      projectId: 'test',
      scenes,
    });

    const textNode = result.blueprint.nodes.find(
      (n) => n.data.nodeType === 'text-input',
    );
    expect((textNode!.data.config as { text: string }).text).toBe('English prompt');
  });

  it('creates text-input + script-import nodes when prompt is empty (no generator)', () => {
    const scenes = [makeScene(0, {
      imagePrompt: '',
      imagePromptZh: '',
      videoPrompt: '',
      videoPromptZh: '',
      actionSummary: '',
      dialogue: '',
    })];
    const result = convertDirectorToBlueprint({
      projectId: 'test',
      scenes,
    });

    // text-input (always) + script-import (always) = 2 nodes, no generator/output
    expect(result.nodeCount).toBe(2);
    expect(result.edgeCount).toBe(0);
    const nodeTypes = result.blueprint.nodes.map((n) => n.data.nodeType);
    expect(nodeTypes).toContain('text-input');
    expect(nodeTypes).toContain('script-import');
    expect(nodeTypes).not.toContain('image-generator');
    expect(nodeTypes).not.toContain('output');
  });

  it('generates legacy-origin diagnostics for each scene', () => {
    const scenes = [makeScene(0)];
    const result = convertDirectorToBlueprint({
      projectId: 'test',
      scenes,
    });

    const legacyDiagnostics = result.diagnostics.filter(
      (d) => d.code === 'director-scene-legacy-origin',
    );
    expect(legacyDiagnostics).toHaveLength(1);
  });

  it('generates missing-prompt diagnostic for scenes without prompts', () => {
    const scenes = [makeScene(0, {
      imagePrompt: '',
      imagePromptZh: '',
      videoPrompt: '',
      videoPromptZh: '',
      actionSummary: '',
      dialogue: '',
    })];
    const result = convertDirectorToBlueprint({
      projectId: 'test',
      scenes,
    });

    const missingPromptDiags = result.diagnostics.filter(
      (d) => d.code === 'director-scene-missing-prompt',
    );
    expect(missingPromptDiags).toHaveLength(1);
  });

  it('uses split scene ID as string in script-import selectedShotIds', () => {
    const scenes = [makeScene(42)];
    const result = convertDirectorToBlueprint({
      projectId: 'test',
      scenes,
    });

    const importNode = result.blueprint.nodes.find(
      (n) => n.data.nodeType === 'script-import',
    );
    expect(importNode).toBeDefined();
    const config = importNode!.data.config as { selectedShotIds: string[] };
    expect(config.selectedShotIds).toEqual(['42']);
  });

  it('handles empty scenes array', () => {
    const result = convertDirectorToBlueprint({
      projectId: 'test',
      scenes: [],
    });

    expect(result.sceneCount).toBe(0);
    expect(result.nodeCount).toBe(0);
    expect(result.blueprint.nodes).toHaveLength(0);
  });
});

describe('previewDirectorToBlueprint', () => {
  it('returns correct preview stats', () => {
    const scenes = [makeScene(0), makeScene(1)];
    const preview = previewDirectorToBlueprint({
      projectId: 'test',
      scenes,
    });

    expect(preview.sceneCount).toBe(2);
    expect(preview.hasPrompts).toBe(2);
    expect(preview.missingPrompts).toBe(0);
    expect(preview.nodeCount).toBe(8); // 4 per scene with prompt
  });

  it('counts missing prompts correctly', () => {
    const scenes = [
      makeScene(0),
      makeScene(1, {
        imagePrompt: '',
        imagePromptZh: '',
        videoPrompt: '',
        videoPromptZh: '',
        actionSummary: '',
        dialogue: '',
      }),
    ];
    const preview = previewDirectorToBlueprint({
      projectId: 'test',
      scenes,
    });

    expect(preview.hasPrompts).toBe(1);
    expect(preview.missingPrompts).toBe(1);
    expect(preview.nodeCount).toBe(6); // 4 (with prompt) + 2 (without prompt: text-input + script-import)
  });

  it('filters by selectedSceneIds', () => {
    const scenes = [makeScene(0), makeScene(1), makeScene(2)];
    const preview = previewDirectorToBlueprint({
      projectId: 'test',
      scenes,
      selectedSceneIds: [1],
    });

    expect(preview.sceneCount).toBe(1);
  });

  it('generates diagnostics for previewed scenes', () => {
    const scenes = [makeScene(0)];
    const preview = previewDirectorToBlueprint({
      projectId: 'test',
      scenes,
    });

    expect(preview.diagnostics.length).toBeGreaterThan(0);
    expect(preview.diagnostics.some(
      (d) => d.code === 'director-scene-legacy-origin',
    )).toBe(true);
  });
});
