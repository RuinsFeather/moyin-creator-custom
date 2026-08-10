// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it, beforeEach } from 'vitest';
import { useBlueprintStore } from '@/stores/blueprint-store';
import type { Shot } from '@/types/script';

// ── Test fixtures ───────────────────────────────────────────────────────────

function makeShot(index: number, overrides: Partial<Shot> = {}): Shot {
  return {
    id: `shot-${index}`,
    index,
    episodeId: '',
    sceneRefId: `scene-${index}`,
    characterIds: [],
    characterVariations: {},
    actionSummary: `Shot ${index} action`,
    imagePrompt: `A test prompt for shot ${index}`,
    imageStatus: 'idle',
    imageProgress: 0,
    videoStatus: 'idle',
    videoProgress: 0,
    ...overrides,
  };
}

function setupProject() {
  const store = useBlueprintStore.getState();
  store.setActiveProjectId('test-project');
  // Clear existing blueprints
  for (const bp of store.blueprints) {
    store.deleteBlueprint(bp.id);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('blueprint-store importFromScript', () => {
  beforeEach(() => {
    setupProject();
  });

  it('creates a new blueprint from shots', () => {
    const store = useBlueprintStore.getState();
    const shots = [makeShot(0), makeShot(1)];

    const result = store.importFromScript({ shots });

    expect(result.shotCount).toBe(2);
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.blueprint.projectId).toBe('test-project');

    // Verify it was added to the store
    const state = useBlueprintStore.getState();
    expect(state.blueprints).toHaveLength(1);
    expect(state.activeBlueprintId).toBe(result.blueprint.id);
  });

  it('uses provided name for new blueprint', () => {
    const store = useBlueprintStore.getState();
    const shots = [makeShot(0)];

    const result = store.importFromScript({ shots, name: '我的蓝图' });

    expect(result.blueprint.name).toBe('我的蓝图');
  });

  it('replaces existing blueprint when target is specified', () => {
    const store = useBlueprintStore.getState();
    const shots = [makeShot(0)];

    // Create first blueprint
    const first = store.importFromScript({ shots, name: '原始蓝图' });
    expect(useBlueprintStore.getState().blueprints).toHaveLength(1);

    // Replace it
    const shots2 = [makeShot(0), makeShot(1), makeShot(2)];
    const second = store.importFromScript(
      { shots: shots2, name: '替换蓝图' },
      first.blueprint.id,
    );

    // Should still be 1 blueprint, but with new content
    const state = useBlueprintStore.getState();
    expect(state.blueprints).toHaveLength(1);
    expect(state.blueprints[0].id).toBe(first.blueprint.id);
    expect(second.shotCount).toBe(3);
  });

  it('throws when no activeProjectId', () => {
    const store = useBlueprintStore.getState();
    store.setActiveProjectId('');

    expect(() => store.importFromScript({ shots: [] })).toThrow('activeProjectId');
  });

  it('generates diagnostics for shots without prompts', () => {
    const store = useBlueprintStore.getState();
    const shots = [
      makeShot(0, { imagePrompt: undefined, visualPrompt: undefined, visualDescription: undefined, actionSummary: '' }),
    ];

    const result = store.importFromScript({ shots });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('shot-missing-prompt');
  });

  it('parses rawScript when shots are not provided', () => {
    const store = useBlueprintStore.getState();
    const rawScript = `## 场景1：外景 - 公园\n\n阳光明媚。`;

    const result = store.importFromScript({ rawScript });
    expect(result.shotCount).toBeGreaterThanOrEqual(1);
  });

  it('resets selection state after import', () => {
    const store = useBlueprintStore.getState();
    store.selectNode('some-node');

    store.importFromScript({ shots: [makeShot(0)] });

    const state = useBlueprintStore.getState();
    expect(state.selectedNodeId).toBeNull();
    expect(state.selectedEdgeId).toBeNull();
  });
});

describe('blueprint-store previewScriptImport', () => {
  beforeEach(() => {
    setupProject();
  });

  it('returns preview without creating blueprint', () => {
    const store = useBlueprintStore.getState();
    const shots = [makeShot(0), makeShot(1)];

    const preview = store.previewScriptImport({ shots });

    expect(preview.shotCount).toBe(2);
    expect(preview.nodeCount).toBeGreaterThan(0);
    expect(preview.diagnostics).toBeDefined();

    // Should NOT create a blueprint
    expect(useBlueprintStore.getState().blueprints).toHaveLength(0);
  });

  it('throws when no activeProjectId', () => {
    const store = useBlueprintStore.getState();
    store.setActiveProjectId('');

    expect(() => store.previewScriptImport({ shots: [] })).toThrow('activeProjectId');
  });

  it('handles rawScript input', () => {
    const store = useBlueprintStore.getState();
    const rawScript = `## 场景1\n\n内容。`;

    // Pass shots as undefined to trigger rawScript parsing fallback
    const preview = store.previewScriptImport({ rawScript });
    expect(preview.shotCount).toBeGreaterThanOrEqual(1);
  });
});
