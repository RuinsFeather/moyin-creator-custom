// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from 'vitest';
import {
  migrateBlueprintState,
  migrateBlueprintDocument,
  migrateBlueprintNode,
  migrateBlueprintEdge,
  type PersistedBlueprintState,
} from '../blueprint-migrations';
import { BLUEPRINT_SCHEMA_VERSION } from '@/types/blueprint';

// ─── migrateBlueprintState ──────────────────────────────────────

describe('migrateBlueprintState', () => {
  it('returns empty defaults for null input', () => {
    const result = migrateBlueprintState(null, 0);
    expect(result).toEqual({
      schemaVersion: BLUEPRINT_SCHEMA_VERSION,
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: [],
    });
  });

  it('returns empty defaults for undefined input', () => {
    const result = migrateBlueprintState(undefined, 0);
    expect(result).toEqual({
      schemaVersion: BLUEPRINT_SCHEMA_VERSION,
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: [],
    });
  });

  it('returns empty defaults for non-object input (string)', () => {
    const result = migrateBlueprintState('invalid', 0);
    expect(result).toEqual({
      schemaVersion: BLUEPRINT_SCHEMA_VERSION,
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: [],
    });
  });

  it('returns empty defaults for non-object input (number)', () => {
    const result = migrateBlueprintState(42, 0);
    expect(result).toEqual({
      schemaVersion: BLUEPRINT_SCHEMA_VERSION,
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: [],
    });
  });

  it('preserves valid activeProjectId and activeBlueprintId', () => {
    const input = {
      activeProjectId: 'proj-1',
      activeBlueprintId: 'bp-1',
      blueprints: [],
    };
    const result = migrateBlueprintState(input, 1);
    expect(result.activeProjectId).toBe('proj-1');
    expect(result.activeBlueprintId).toBe('bp-1');
  });

  it('defaults activeProjectId to empty string for non-string value', () => {
    const input = {
      activeProjectId: 123,
      activeBlueprintId: null,
      blueprints: [],
    };
    const result = migrateBlueprintState(input, 1);
    expect(result.activeProjectId).toBe('');
  });

  it('defaults activeBlueprintId to null for non-string value', () => {
    const input = {
      activeProjectId: 'proj-1',
      activeBlueprintId: 123,
      blueprints: [],
    };
    const result = migrateBlueprintState(input, 1);
    expect(result.activeBlueprintId).toBeNull();
  });

  it('normalizes non-array blueprints to empty array', () => {
    const input = {
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: 'not-an-array',
    };
    const result = migrateBlueprintState(input, 1);
    expect(result.blueprints).toEqual([]);
  });

  it('always stamps schemaVersion to current', () => {
    const input = {
      schemaVersion: 0,
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: [],
    };
    const result = migrateBlueprintState(input, 0);
    expect(result.schemaVersion).toBe(BLUEPRINT_SCHEMA_VERSION);
  });

  it('migrates each blueprint document in the collection', () => {
    const input = {
      activeProjectId: 'proj-1',
      activeBlueprintId: 'bp-1',
      blueprints: [
        {
          id: 'bp-1',
          projectId: 'proj-1',
          name: 'Test Blueprint',
          version: 1,
          nodes: [
            {
              id: 'n1',
              type: 'text-input',
              position: { x: 10, y: 20 },
              data: { nodeType: 'text-input', label: 'Prompt', config: { text: 'hello' } },
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          status: 'draft',
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    };
    const result = migrateBlueprintState(input, 1);
    expect(result.blueprints).toHaveLength(1);
    expect(result.blueprints[0].id).toBe('bp-1');
    expect(result.blueprints[0].nodes).toHaveLength(1);
    expect(result.blueprints[0].version).toBe(BLUEPRINT_SCHEMA_VERSION);
  });

  it('handles blueprints with missing required fields gracefully', () => {
    const input = {
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: [
        { id: 'bp-1' },  // minimal object
      ],
    };
    const result = migrateBlueprintState(input, 1);
    expect(result.blueprints).toHaveLength(1);
    const bp = result.blueprints[0];
    expect(bp.projectId).toBe('');
    expect(bp.name).toBe('Untitled');
    expect(bp.nodes).toEqual([]);
    expect(bp.edges).toEqual([]);
    expect(bp.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(bp.status).toBe('draft');
    expect(bp.version).toBe(BLUEPRINT_SCHEMA_VERSION);
  });

  it('filters out edge references to non-existent nodes', () => {
    const input = {
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: [
        {
          id: 'bp-1',
          projectId: 'proj-1',
          nodes: [
            { id: 'n1', type: 'text-input', position: { x: 0, y: 0 }, data: { nodeType: 'text-input', label: 'A', config: {} } },
            { id: 'n2', type: 'output', position: { x: 0, y: 0 }, data: { nodeType: 'output', label: 'B', config: {} } },
          ],
          edges: [
            { id: 'e1', source: 'n1', target: 'n2', type: 'blueprint', data: { dataType: 'text' } },
            { id: 'e2', source: 'n1', target: 'n3-missing', type: 'blueprint', data: { dataType: 'text' } },
          ],
        },
      ],
    };
    const result = migrateBlueprintState(input, 1);
    expect(result.blueprints[0].edges).toHaveLength(1);
    expect(result.blueprints[0].edges[0].id).toBe('e1');
  });

  it('handles completely malformed blueprint entries without crashing', () => {
    const input = {
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: [
        null,
        undefined,
        'string',
        42,
        { id: 'valid', projectId: 'p1', nodes: [], edges: [] },
      ],
    };
    const result = migrateBlueprintState(input, 1);
    // All 5 entries should be migrated (invalid ones become default documents)
    expect(result.blueprints).toHaveLength(5);
    // The valid one should keep its id
    expect(result.blueprints[4].id).toBe('valid');
  });
});

// ─── migrateBlueprintDocument ───────────────────────────────────

describe('migrateBlueprintDocument', () => {
  it('returns a default document for null input', () => {
    const doc = migrateBlueprintDocument(null);
    expect(doc.id).toBe('unknown');
    expect(doc.name).toBe('Untitled');
    expect(doc.status).toBe('draft');
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
    expect(doc.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(doc.version).toBe(BLUEPRINT_SCHEMA_VERSION);
  });

  it('preserves valid fields from a complete document', () => {
    const input = {
      id: 'bp-1',
      projectId: 'proj-1',
      name: 'My Blueprint',
      version: 1,
      nodes: [],
      edges: [],
      viewport: { x: 100, y: 200, zoom: 0.5 },
      status: 'completed' as const,
      createdAt: 1000,
      updatedAt: 2000,
      sourceScriptVersion: 'v3',
    };
    const doc = migrateBlueprintDocument(input);
    expect(doc.id).toBe('bp-1');
    expect(doc.projectId).toBe('proj-1');
    expect(doc.name).toBe('My Blueprint');
    expect(doc.viewport).toEqual({ x: 100, y: 200, zoom: 0.5 });
    expect(doc.status).toBe('completed');
    expect(doc.sourceScriptVersion).toBe('v3');
  });

  it('defaults invalid status to draft', () => {
    const input = { id: 'bp-1', status: 'invalid-status' };
    const doc = migrateBlueprintDocument(input);
    expect(doc.status).toBe('draft');
  });

  it('defaults missing timestamps to now', () => {
    const before = Date.now();
    const doc = migrateBlueprintDocument({ id: 'bp-1' });
    const after = Date.now();
    expect(doc.createdAt).toBeGreaterThanOrEqual(before);
    expect(doc.createdAt).toBeLessThanOrEqual(after);
    expect(doc.updatedAt).toBeGreaterThanOrEqual(before);
    expect(doc.updatedAt).toBeLessThanOrEqual(after);
  });

  it('normalizes viewport with missing zoom', () => {
    const input = { id: 'bp-1', viewport: { x: 10, y: 20 } };
    const doc = migrateBlueprintDocument(input);
    expect(doc.viewport).toEqual({ x: 10, y: 20, zoom: 1 });
  });

  it('normalizes viewport with missing x/y', () => {
    const input = { id: 'bp-1', viewport: { zoom: 2 } };
    const doc = migrateBlueprintDocument(input);
    expect(doc.viewport).toEqual({ x: 0, y: 0, zoom: 2 });
  });

  it('normalizes completely invalid viewport', () => {
    const input = { id: 'bp-1', viewport: 'not-an-object' };
    const doc = migrateBlueprintDocument(input);
    expect(doc.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('defaults non-array nodes/edges to empty arrays', () => {
    const input = { id: 'bp-1', nodes: 'not-array', edges: 'not-array' };
    const doc = migrateBlueprintDocument(input);
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
  });

  it('preserves sourceScriptVersion when present', () => {
    const input = { id: 'bp-1', sourceScriptVersion: 'v5' };
    const doc = migrateBlueprintDocument(input);
    expect(doc.sourceScriptVersion).toBe('v5');
  });

  it('does not include sourceScriptVersion when absent', () => {
    const doc = migrateBlueprintDocument({ id: 'bp-1' });
    expect(doc).not.toHaveProperty('sourceScriptVersion');
  });
});

// ─── migrateBlueprintNode ───────────────────────────────────────

describe('migrateBlueprintNode', () => {
  it('returns a default text-input node for null input', () => {
    const node = migrateBlueprintNode(null);
    expect(node.id).toBe('unknown');
    expect(node.type).toBe('text-input');
    expect(node.position).toEqual({ x: 0, y: 0 });
    expect(node.data.nodeType).toBe('text-input');
  });

  it('preserves valid node data', () => {
    const input = {
      id: 'n1',
      type: 'image-generator',
      position: { x: 50, y: 100 },
      data: {
        nodeType: 'image-generator',
        label: 'Generate Image',
        config: { prompt: 'a cat' },
      },
    };
    const node = migrateBlueprintNode(input);
    expect(node.id).toBe('n1');
    expect(node.type).toBe('image-generator');
    expect(node.position).toEqual({ x: 50, y: 100 });
    expect(node.data.label).toBe('Generate Image');
  });

  it('falls back to text-input for unknown node type', () => {
    const input = {
      id: 'n1',
      type: 'director-scene',
      position: { x: 0, y: 0 },
      data: { nodeType: 'director-scene', label: 'Scene', config: {} },
    };
    const node = migrateBlueprintNode(input);
    expect(node.type).toBe('text-input');
    expect(node.data.nodeType).toBe('text-input');
  });

  it('normalizes data.nodeType when missing', () => {
    const input = {
      id: 'n1',
      type: 'output',
      position: { x: 0, y: 0 },
      data: { label: 'Out', config: {} },
    };
    const node = migrateBlueprintNode(input);
    expect(node.data.nodeType).toBe('output');
  });

  it('normalizes data.label when missing', () => {
    const input = {
      id: 'n1',
      type: 'text-input',
      position: { x: 0, y: 0 },
      data: { nodeType: 'text-input', config: {} },
    };
    const node = migrateBlueprintNode(input);
    expect(node.data.label).toBe('text-input');
  });

  it('normalizes data.config when missing', () => {
    const input = {
      id: 'n1',
      type: 'text-input',
      position: { x: 0, y: 0 },
      data: { nodeType: 'text-input', label: 'Prompt' },
    };
    const node = migrateBlueprintNode(input);
    expect(node.data.config).toBeDefined();
    expect((node.data.config as Record<string, unknown>).text).toBe('');
  });

  it('provides default config for script-import nodes', () => {
    const input = {
      id: 'n1',
      type: 'script-import',
      position: { x: 0, y: 0 },
      data: { nodeType: 'script-import', label: 'Script' },
    };
    const node = migrateBlueprintNode(input);
    const config = node.data.config as Record<string, unknown>;
    expect(config.selectedShotIds).toEqual([]);
    expect(config.mode).toBe('snapshot');
  });

  it('provides default config for output nodes', () => {
    const input = {
      id: 'n1',
      type: 'output',
      position: { x: 0, y: 0 },
      data: { nodeType: 'output', label: 'Out' },
    };
    const node = migrateBlueprintNode(input);
    const config = node.data.config as Record<string, unknown>;
    expect(config.acceptedTypes).toEqual(['image']);
  });

  it('normalizes position with missing y', () => {
    const input = {
      id: 'n1',
      type: 'text-input',
      position: { x: 10 },
      data: { nodeType: 'text-input', label: 'A', config: {} },
    };
    const node = migrateBlueprintNode(input);
    expect(node.position).toEqual({ x: 10, y: 0 });
  });

  it('defaults position to origin when completely missing', () => {
    const input = {
      id: 'n1',
      type: 'text-input',
      data: { nodeType: 'text-input', label: 'A', config: {} },
    };
    const node = migrateBlueprintNode(input);
    expect(node.position).toEqual({ x: 0, y: 0 });
  });

  it('defaults id to unknown when missing', () => {
    const input = {
      type: 'text-input',
      position: { x: 0, y: 0 },
      data: { nodeType: 'text-input', label: 'A', config: {} },
    };
    const node = migrateBlueprintNode(input);
    expect(node.id).toBe('unknown');
  });

  it('completely empty data object gets all defaults', () => {
    const input = {
      id: 'n1',
      type: 'image-generator',
      position: { x: 0, y: 0 },
      data: {},
    };
    const node = migrateBlueprintNode(input);
    expect(node.data.nodeType).toBe('image-generator');
    expect(node.data.label).toBe('image-generator');
    expect(node.data.config).toBeDefined();
  });

  it('preserves optional React Flow properties', () => {
    const input = {
      id: 'n1',
      type: 'text-input',
      position: { x: 0, y: 0 },
      data: { nodeType: 'text-input', label: 'A', config: {} },
      hidden: true,
      selected: false,
      draggable: false,
    };
    const node = migrateBlueprintNode(input);
    expect(node.hidden).toBe(true);
    expect(node.selected).toBe(false);
    expect(node.draggable).toBe(false);
  });
});

// ─── migrateBlueprintEdge ───────────────────────────────────────

describe('migrateBlueprintEdge', () => {
  it('returns a default edge for null input', () => {
    const edge = migrateBlueprintEdge(null);
    expect(edge.id).toBe('unknown');
    expect(edge.source).toBe('');
    expect(edge.target).toBe('');
    expect(edge.data?.dataType).toBe('text');
  });

  it('preserves valid edge data', () => {
    const input = {
      id: 'e1',
      source: 'n1',
      target: 'n2',
      type: 'blueprint',
      data: { dataType: 'image', order: 1 },
    };
    const edge = migrateBlueprintEdge(input);
    expect(edge.id).toBe('e1');
    expect(edge.source).toBe('n1');
    expect(edge.target).toBe('n2');
    expect(edge.data?.dataType).toBe('image');
  });

  it('defaults missing dataType to text', () => {
    const input = {
      id: 'e1',
      source: 'n1',
      target: 'n2',
      data: {},
    };
    const edge = migrateBlueprintEdge(input);
    expect(edge.data?.dataType).toBe('text');
  });

  it('defaults missing data object', () => {
    const input = {
      id: 'e1',
      source: 'n1',
      target: 'n2',
    };
    const edge = migrateBlueprintEdge(input);
    expect(edge.data?.dataType).toBe('text');
  });

  it('defaults missing type to blueprint', () => {
    const input = {
      id: 'e1',
      source: 'n1',
      target: 'n2',
      data: { dataType: 'text' },
    };
    const edge = migrateBlueprintEdge(input);
    expect(edge.type).toBe('blueprint');
  });

  it('preserves optional edge properties', () => {
    const input = {
      id: 'e1',
      source: 'n1',
      target: 'n2',
      type: 'blueprint',
      data: { dataType: 'text' },
      sourceHandle: 'out',
      targetHandle: 'in',
      animated: true,
    };
    const edge = migrateBlueprintEdge(input);
    expect(edge.sourceHandle).toBe('out');
    expect(edge.targetHandle).toBe('in');
    expect(edge.animated).toBe(true);
  });
});

// ─── Idempotency ────────────────────────────────────────────────

describe('migration idempotency', () => {
  it('running migration twice produces the same result', () => {
    const input: PersistedBlueprintState = {
      schemaVersion: 1,
      activeProjectId: 'proj-1',
      activeBlueprintId: 'bp-1',
      blueprints: [
        {
          id: 'bp-1',
          projectId: 'proj-1',
          name: 'Test',
          version: 1,
          nodes: [
            {
              id: 'n1',
              type: 'text-input',
              position: { x: 10, y: 20 },
              data: { nodeType: 'text-input', label: 'Prompt', config: { text: 'hello' } },
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          status: 'draft',
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    };

    const first = migrateBlueprintState(input, 1);
    const second = migrateBlueprintState(first, first.schemaVersion);

    expect(second).toEqual(first);
  });

  it('running migration on already-normalized data is a no-op', () => {
    const input = {
      schemaVersion: BLUEPRINT_SCHEMA_VERSION,
      activeProjectId: 'proj-1',
      activeBlueprintId: null,
      blueprints: [],
    };
    const result = migrateBlueprintState(input, BLUEPRINT_SCHEMA_VERSION);
    expect(result).toEqual(input);
  });
});
