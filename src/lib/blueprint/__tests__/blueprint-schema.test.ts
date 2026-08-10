// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_NODE_TYPES,
  canConnectBlueprintPorts,
  createEmptyBlueprintProject,
  isBlueprintProject,
  isBlueprintNodeType,
  isBlueprintSourceStale,
} from '../blueprint-schema';
import {
  BLUEPRINT_COPY_POLICY,
  BLUEPRINT_SCHEMA_VERSION,
  type BlueprintNode,
} from '@/types/blueprint';

describe('blueprint schema', () => {
  it('recognizes only registered node types', () => {
    expect(BLUEPRINT_NODE_TYPES).toContain('image-generator');
    expect(isBlueprintNodeType('output')).toBe(true);
    expect(isBlueprintNodeType('unknown')).toBe(false);
  });

  it('creates a versioned empty project for the owning project', () => {
    const blueprint = createEmptyBlueprintProject('project-a', 'blueprint-a', '测试蓝图', 100);

    expect(blueprint).toMatchObject({
      id: 'blueprint-a',
      projectId: 'project-a',
      name: '测试蓝图',
      version: BLUEPRINT_SCHEMA_VERSION,
      nodes: [],
      edges: [],
      createdAt: 100,
      updatedAt: 100,
    });
  });

  it('accepts only compatible explicit node ports', () => {
    expect(
      canConnectBlueprintPorts(
        'text-input',
        'text',
        'image-generator',
        'prompt',
        'text',
      ),
    ).toBe(true);
    expect(
      canConnectBlueprintPorts(
        'image-reference',
        'image',
        'image-generator',
        'prompt',
        'image',
      ),
    ).toBe(false);
    expect(
      canConnectBlueprintPorts(
        'text-input',
        'missing',
        'image-generator',
        'prompt',
        'text',
      ),
    ).toBe(false);
  });

  it('marks only known source version changes as stale', () => {
    const sourceRef = { kind: 'shot' as const, id: 'shot-a', sourceVersion: 'v1' };

    expect(isBlueprintSourceStale(sourceRef, 'v1')).toBe(false);
    expect(isBlueprintSourceStale(sourceRef, 'v2')).toBe(true);
    expect(isBlueprintSourceStale(sourceRef, undefined)).toBe(false);
  });

  it('rejects a snapshot that does not match its source reference', () => {
    const blueprint = createEmptyBlueprintProject('project-a', 'blueprint-a');
    const node: BlueprintNode = {
      id: 'script-a',
      type: 'script-import',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'script-import',
        label: '分镜快照',
        config: { selectedShotIds: ['shot-a'], mode: 'snapshot' },
        sourceRef: { kind: 'shot', id: 'shot-a', sourceVersion: 'v2' },
        sourceSnapshot: {
          kind: 'shot',
          sourceId: 'shot-a',
          sourceVersion: 'v1',
          capturedAt: 100,
          data: { imagePrompt: 'prompt' },
        },
      },
    };

    blueprint.nodes.push(node);
    expect(isBlueprintProject(blueprint)).toBe(false);
  });

  it('defines copy semantics without sharing execution identity', () => {
    expect(BLUEPRINT_COPY_POLICY).toEqual({
      preserveSourceSnapshots: true,
      preserveMediaReferences: true,
      resetExecutionState: true,
      regenerateBlueprintId: true,
      regenerateNodeAndEdgeIds: true,
    });
  });
});
