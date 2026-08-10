// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from 'vitest';
import type {
  BlueprintNode,
  BlueprintEdge,
  BlueprintProject,
  BlueprintDataType,
} from '@/types/blueprint';
import {
  validateBlueprintGraph,
  isBlueprintGraphValid,
  getBlueprintErrors,
  getBlueprintWarnings,
  BLUEPRINT_DIAGNOSTIC_CODES,
} from '../graph-validation';

const codes = BLUEPRINT_DIAGNOSTIC_CODES;

// ── Test helpers ──────────────────────────────────────────────────────────

function makeNode(
  id: string,
  nodeType: BlueprintNode['data']['nodeType'],
  config: Record<string, unknown> = {},
): BlueprintNode {
  return {
    id,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: {
      nodeType,
      label: `${nodeType} (${id})`,
      config: config as BlueprintNode['data']['config'],
    },
  } as BlueprintNode;
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string,
  dataType: BlueprintDataType,
): BlueprintEdge {
  return {
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    data: { dataType },
  } as BlueprintEdge;
}

function makeProject(
  nodes: BlueprintNode[],
  edges: BlueprintEdge[] = [],
): BlueprintProject {
  return {
    id: 'test-blueprint',
    projectId: 'test-project',
    name: '测试蓝图',
    version: 1,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('graph-validation: validateBlueprintGraph', () => {
  // ── Valid graph ─────────────────────────────────────────────────

  describe('valid graph', () => {
    it('returns empty diagnostics for a simple valid text→image→output pipeline', () => {
      const nodes = [
        makeNode('t1', 'text-input', { text: 'A cat' }),
        makeNode('g1', 'image-generator', { model: 'test-model' }),
        makeNode('o1', 'output', { acceptedTypes: ['image'] }),
      ];
      const edges = [
        makeEdge('e1', 't1', 'g1', 'text', 'prompt', 'text'),
        makeEdge('e2', 'g1', 'o1', 'image', 'media', 'image'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      expect(diagnostics).toHaveLength(0);
    });

    it('returns empty diagnostics for an empty graph', () => {
      const project = makeProject([]);
      expect(validateBlueprintGraph({ project })).toHaveLength(0);
    });
  });

  // ── Duplicate node IDs ─────────────────────────────────────────

  describe('duplicate node IDs', () => {
    it('flags nodes with the same ID (second occurrence)', () => {
      const nodes = [
        makeNode('dup', 'text-input'),
        makeNode('dup', 'text-input'),
      ];
      const project = makeProject(nodes);

      const diagnostics = validateBlueprintGraph({ project });
      // Diagnostic is emitted on the 2nd (duplicate) occurrence
      const dupDiag = diagnostics.filter((d) => d.code === codes.duplicateNodeId);
      expect(dupDiag).toHaveLength(1);
      expect(dupDiag[0].severity).toBe('error');
    });
  });

  // ── Invalid node type ──────────────────────────────────────────

  describe('invalid node type', () => {
    it('flags a node with an unknown type', () => {
      const node = makeNode('n1', 'text-input');
      // Force an invalid type
      (node.data as { nodeType: string }).nodeType = 'unknown-type';
      const project = makeProject([node]);

      const diagnostics = validateBlueprintGraph({ project });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe(codes.invalidNodeType);
      expect(diagnostics[0].severity).toBe('error');
    });
  });

  // ── Missing edge endpoints ─────────────────────────────────────

  describe('missing edge source/target', () => {
    it('flags edge with missing source node', () => {
      const nodes = [makeNode('t1', 'text-input')];
      const edges = [makeEdge('e1', 'nonexistent', 't1', 'text', 'prompt', 'text')];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe(codes.missingEdgeSource);
    });

    it('flags edge with missing target node', () => {
      const nodes = [makeNode('t1', 'text-input')];
      const edges = [makeEdge('e1', 't1', 'nonexistent', 'text', 'prompt', 'text')];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe(codes.missingEdgeTarget);
    });
  });

  // ── Self-loop ──────────────────────────────────────────────────

  describe('self-loop', () => {
    it('flags an edge where source === target', () => {
      const nodes = [makeNode('t1', 'text-input')];
      const edges = [makeEdge('e1', 't1', 't1', 'text', 'prompt', 'text')];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const selfLoopDiag = diagnostics.filter((d) => d.code === codes.selfLoop);
      expect(selfLoopDiag).toHaveLength(1);
      expect(selfLoopDiag[0].severity).toBe('error');
    });
  });

  // ── Duplicate edges ────────────────────────────────────────────

  describe('duplicate edges', () => {
    it('warns about edges with identical source+handle → target+handle', () => {
      const nodes = [
        makeNode('t1', 'text-input'),
        makeNode('g1', 'image-generator'),
      ];
      const edges = [
        makeEdge('e1', 't1', 'g1', 'text', 'prompt', 'text'),
        makeEdge('e2', 't1', 'g1', 'text', 'prompt', 'text'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const dupWarnings = diagnostics.filter((d) => d.code === codes.duplicateEdge);
      expect(dupWarnings).toHaveLength(1);
      expect(dupWarnings[0].severity).toBe('warning');
    });

    it('allows edges from same source to different target ports', () => {
      const nodes = [
        makeNode('i1', 'image-reference'),
        makeNode('g1', 'image-generator'),
      ];
      const edges = [
        makeEdge('e1', 'i1', 'g1', 'image', 'prompt', 'image'),
        makeEdge('e2', 'i1', 'g1', 'image', 'reference-images', 'image'),
      ];
      // Note: 'image' → 'prompt' will fail data type compat but NOT duplicate edge
      const project = makeProject(nodes, edges);
      const diagnostics = validateBlueprintGraph({ project });
      const dupEdges = diagnostics.filter((d) => d.code === codes.duplicateEdge);
      expect(dupEdges).toHaveLength(0);
    });
  });

  // ── Cycle detection ────────────────────────────────────────────

  describe('cycle detection', () => {
    it('detects a two-node cycle', () => {
      const nodes = [
        makeNode('a', 'text-input'),
        makeNode('b', 'text-input'),
      ];
      // Force a cycle by connecting a→b and b→a
      const edges = [
        makeEdge('e1', 'a', 'b', 'text', 'prompt', 'text'),
        makeEdge('e2', 'b', 'a', 'text', 'prompt', 'text'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const cycleDiag = diagnostics.filter((d) => d.code === codes.cycle);
      expect(cycleDiag).toHaveLength(1);
      expect(cycleDiag[0].severity).toBe('error');
    });

    it('detects a three-node cycle', () => {
      const nodes = [
        makeNode('a', 'text-input'),
        makeNode('b', 'text-input'),
        makeNode('c', 'text-input'),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'text', 'prompt', 'text'),
        makeEdge('e2', 'b', 'c', 'text', 'prompt', 'text'),
        makeEdge('e3', 'c', 'a', 'text', 'prompt', 'text'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const cycleDiag = diagnostics.filter((d) => d.code === codes.cycle);
      expect(cycleDiag).toHaveLength(1);
    });

    it('does not flag an acyclic graph', () => {
      const nodes = [
        makeNode('a', 'text-input'),
        makeNode('b', 'image-generator'),
        makeNode('c', 'output', { acceptedTypes: ['image'] }),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b', 'text', 'prompt', 'text'),
        makeEdge('e2', 'b', 'c', 'image', 'media', 'image'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const cycleDiag = diagnostics.filter((d) => d.code === codes.cycle);
      expect(cycleDiag).toHaveLength(0);
    });
  });

  // ── Invalid port ───────────────────────────────────────────────

  describe('invalid port', () => {
    it('flags edge with unknown source handle', () => {
      const nodes = [
        makeNode('t1', 'text-input'),
        makeNode('g1', 'image-generator'),
      ];
      const edges = [makeEdge('e1', 't1', 'g1', 'nonexistent', 'prompt', 'text')];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const portDiag = diagnostics.filter((d) => d.code === codes.invalidPort);
      expect(portDiag).toHaveLength(1);
      expect(portDiag[0].nodeId).toBe('t1');
    });

    it('flags edge with unknown target handle', () => {
      const nodes = [
        makeNode('t1', 'text-input'),
        makeNode('g1', 'image-generator'),
      ];
      const edges = [makeEdge('e1', 't1', 'g1', 'text', 'nonexistent', 'text')];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const portDiag = diagnostics.filter((d) => d.code === codes.invalidPort);
      expect(portDiag).toHaveLength(1);
      expect(portDiag[0].nodeId).toBe('g1');
    });
  });

  // ── Incompatible data type ─────────────────────────────────────

  describe('incompatible data type', () => {
    it('flags edge where source port does not support the edge data type', () => {
      // image-reference outputs 'image', but image-generator prompt port expects 'text'|'context'
      const nodes = [
        makeNode('i1', 'image-reference'),
        makeNode('g1', 'image-generator'),
      ];
      const edges = [
        makeEdge('e1', 'i1', 'g1', 'image', 'prompt', 'image'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const typeDiag = diagnostics.filter(
        (d) => d.code === codes.incompatibleDataType,
      );
      expect(typeDiag).toHaveLength(1);
      expect(typeDiag[0].severity).toBe('error');
    });

    it('allows compatible text connection', () => {
      const nodes = [
        makeNode('t1', 'text-input', { text: 'prompt' }),
        makeNode('g1', 'image-generator'),
      ];
      const edges = [
        makeEdge('e1', 't1', 'g1', 'text', 'prompt', 'text'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const typeDiag = diagnostics.filter(
        (d) => d.code === codes.incompatibleDataType,
      );
      expect(typeDiag).toHaveLength(0);
    });
  });

  // ── Missing required input ─────────────────────────────────────

  describe('required input', () => {
    it('does not flag output node when media port is not marked required', () => {
      // The output port "media" is not marked required in BLUEPRINT_NODE_PORTS
      const nodes = [makeNode('o1', 'output', { acceptedTypes: ['image'] })];
      const project = makeProject(nodes);

      const diagnostics = validateBlueprintGraph({ project });
      const reqDiag = diagnostics.filter(
        (d) => d.code === codes.missingRequiredInput,
      );
      expect(reqDiag).toHaveLength(0);
    });

    it('does not flag output node when required input is connected', () => {
      const nodes = [
        makeNode('g1', 'image-generator'),
        makeNode('o1', 'output', { acceptedTypes: ['image'] }),
      ];
      const edges = [
        makeEdge('e1', 'g1', 'o1', 'image', 'media', 'image'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const reqDiag = diagnostics.filter(
        (d) => d.code === codes.missingRequiredInput,
      );
      expect(reqDiag).toHaveLength(0);
    });
  });

  // ── Generator missing prompt ───────────────────────────────────

  describe('generator missing prompt', () => {
    it('warns when image-generator has no inline prompt and no upstream text', () => {
      const nodes = [
        makeNode('g1', 'image-generator'),
        makeNode('o1', 'output', { acceptedTypes: ['image'] }),
      ];
      const edges = [
        makeEdge('e1', 'g1', 'o1', 'image', 'media', 'image'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const promptDiag = diagnostics.filter(
        (d) => d.code === codes.generatorMissingPrompt,
      );
      expect(promptDiag).toHaveLength(1);
      expect(promptDiag[0].severity).toBe('warning');
      expect(promptDiag[0].nodeId).toBe('g1');
    });

    it('does not warn when generator has inline prompt', () => {
      const nodes = [
        makeNode('g1', 'image-generator', { prompt: 'A beautiful cat' }),
        makeNode('o1', 'output', { acceptedTypes: ['image'] }),
      ];
      const edges = [
        makeEdge('e1', 'g1', 'o1', 'image', 'media', 'image'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const promptDiag = diagnostics.filter(
        (d) => d.code === codes.generatorMissingPrompt,
      );
      expect(promptDiag).toHaveLength(0);
    });

    it('does not warn when generator has upstream text input', () => {
      const nodes = [
        makeNode('t1', 'text-input', { text: 'A cat' }),
        makeNode('g1', 'image-generator'),
        makeNode('o1', 'output', { acceptedTypes: ['image'] }),
      ];
      const edges = [
        makeEdge('e1', 't1', 'g1', 'text', 'prompt', 'text'),
        makeEdge('e2', 'g1', 'o1', 'image', 'media', 'image'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const promptDiag = diagnostics.filter(
        (d) => d.code === codes.generatorMissingPrompt,
      );
      expect(promptDiag).toHaveLength(0);
    });

    it('does not warn when generator has upstream context input', () => {
      const nodes = [
        makeNode('s1', 'script-import'),
        makeNode('g1', 'image-generator'),
        makeNode('o1', 'output', { acceptedTypes: ['image'] }),
      ];
      const edges = [
        makeEdge('e1', 's1', 'g1', 'context', 'prompt', 'context'),
        makeEdge('e2', 'g1', 'o1', 'image', 'media', 'image'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const promptDiag = diagnostics.filter(
        (d) => d.code === codes.generatorMissingPrompt,
      );
      expect(promptDiag).toHaveLength(0);
    });
  });

  // ── Output no upstream ─────────────────────────────────────────

  describe('output no upstream', () => {
    it('warns when output node has no upstream connections', () => {
      const nodes = [makeNode('o1', 'output', { acceptedTypes: ['image'] })];
      const project = makeProject(nodes);

      const diagnostics = validateBlueprintGraph({ project });
      const upstreamDiag = diagnostics.filter(
        (d) => d.code === codes.outputNoUpstream,
      );
      expect(upstreamDiag).toHaveLength(1);
      expect(upstreamDiag[0].severity).toBe('warning');
    });

    it('does not warn when output node has an upstream connection', () => {
      const nodes = [
        makeNode('g1', 'image-generator', { prompt: 'cat' }),
        makeNode('o1', 'output', { acceptedTypes: ['image'] }),
      ];
      const edges = [
        makeEdge('e1', 'g1', 'o1', 'image', 'media', 'image'),
      ];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const upstreamDiag = diagnostics.filter(
        (d) => d.code === codes.outputNoUpstream,
      );
      expect(upstreamDiag).toHaveLength(0);
    });
  });

  // ── Multiple diagnostics in one graph ──────────────────────────

  describe('combined diagnostics', () => {
    it('reports all errors in a complex graph with multiple issues', () => {
      const nodes = [
        makeNode('dup', 'text-input'),
        makeNode('dup', 'text-input'),       // duplicate ID
        makeNode('g1', 'image-generator'),    // no prompt
        makeNode('o1', 'output', { acceptedTypes: ['image'] }), // no upstream
      ];
      const edges: BlueprintEdge[] = [];
      const project = makeProject(nodes, edges);

      const diagnostics = validateBlueprintGraph({ project });
      const errorCodes = diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => d.code);
      const warningCodes = diagnostics
        .filter((d) => d.severity === 'warning')
        .map((d) => d.code);

      expect(errorCodes).toContain(codes.duplicateNodeId);
      // output media port is not marked required, so no missingRequiredInput
      expect(warningCodes).toContain(codes.generatorMissingPrompt);
      expect(warningCodes).toContain(codes.outputNoUpstream);
    });
  });

  // ── Convenience wrappers ───────────────────────────────────────

  describe('convenience wrappers', () => {
    it('isBlueprintGraphValid returns true for a valid graph', () => {
      const nodes = [
        makeNode('t1', 'text-input', { text: 'cat' }),
        makeNode('g1', 'image-generator'),
        makeNode('o1', 'output', { acceptedTypes: ['image'] }),
      ];
      const edges = [
        makeEdge('e1', 't1', 'g1', 'text', 'prompt', 'text'),
        makeEdge('e2', 'g1', 'o1', 'image', 'media', 'image'),
      ];
      const project = makeProject(nodes, edges);

      expect(isBlueprintGraphValid(project)).toBe(true);
    });

    it('isBlueprintGraphValid returns false when errors exist', () => {
      const nodes = [
        makeNode('dup', 'text-input'),
        makeNode('dup', 'text-input'),
      ];
      const project = makeProject(nodes);

      expect(isBlueprintGraphValid(project)).toBe(false);
    });

    it('getBlueprintErrors returns only errors', () => {
      const nodes = [
        makeNode('dup', 'text-input'),
        makeNode('dup', 'text-input'),
        makeNode('g1', 'image-generator'), // warning: missing prompt
      ];
      const project = makeProject(nodes);

      const errors = getBlueprintErrors(project);
      expect(errors.every((d) => d.severity === 'error')).toBe(true);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('getBlueprintWarnings returns only warnings', () => {
      const nodes = [
        makeNode('g1', 'image-generator'), // warning: missing prompt
        makeNode('o1', 'output', { acceptedTypes: ['image'] }), // warning: no upstream + missing required
      ];
      const project = makeProject(nodes);

      const warnings = getBlueprintWarnings(project);
      expect(warnings.every((d) => d.severity === 'warning')).toBe(true);
    });
  });

  // ── BlueprintDiagnosticCodes coverage ──────────────────────────

  describe('diagnostic codes coverage', () => {
    it('exposes all expected diagnostic codes', () => {
      expect(codes.duplicateNodeId).toBe('duplicate-node-id');
      expect(codes.invalidNodeType).toBe('invalid-node-type');
      expect(codes.missingEdgeSource).toBe('missing-edge-source');
      expect(codes.missingEdgeTarget).toBe('missing-edge-target');
      expect(codes.selfLoop).toBe('self-loop');
      expect(codes.duplicateEdge).toBe('duplicate-edge');
      expect(codes.cycle).toBe('cycle');
      expect(codes.invalidPort).toBe('invalid-port');
      expect(codes.incompatibleDataType).toBe('incompatible-data-type');
      expect(codes.missingRequiredInput).toBe('missing-required-input');
      expect(codes.generatorMissingPrompt).toBe('generator-missing-prompt');
      expect(codes.outputNoUpstream).toBe('output-no-upstream');
    });
  });
});
