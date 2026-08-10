// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Generation Chain Boundary Tests (§9.3)
 *
 * These tests enforce the architectural boundary between:
 * - Blueprint system (Freedom API only)
 * - Director system (Director's own parameter/state chain)
 * - S-Class system (ShotGroup, grid images, multi-shot narrative)
 * - Storyboard system (joint images, grid images, scene splitting)
 *
 * The boundary rules are:
 * 1. Blueprint image/video generators use Freedom API exclusively.
 * 2. Director capabilities continue using Director's own parameter/state chain.
 * 3. Storyboard grid images, joint images, and scene splitting are NOT replicated in blueprint.
 * 4. If Director nodes are needed, a separate adapter reads SplitScene —
 *    Director API must not be treated as Freedom API.
 */

import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_NODE_PORTS,
  type BlueprintNodeType,
  type BlueprintSourceKind,
} from '@/types/blueprint';
import { NODE_EXECUTORS } from '../node-executors';
import { convertDirectorToBlueprint } from '../director-to-blueprint';
import { validateLegacyDirectorSourceRefs, BLUEPRINT_DIAGNOSTIC_CODES } from '../graph-validation';

// ── Allowed node types ────────────────────────────────────────────────────

const ALLOWED_NODE_TYPES: readonly BlueprintNodeType[] = [
  'text-input',
  'image-reference',
  'video-reference',
  'script-import',
  'image-generator',
  'video-generator',
  'output',
];

// Director/S-Class/Storyboard-specific types that must NOT appear in blueprint
const PROHIBITED_NODE_TYPES = [
  'director-scene',
  'director-generator',
  'sclass-group',
  'sclass-generator',
  'storyboard-grid',
  'storyboard-joint',
  'storyboard-split',
] as const;

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Generation Chain Boundary (§9.3)', () => {
  describe('BlueprintNodeType is closed to Director/S-Class types', () => {
    it('defines exactly the expected set of node types', () => {
      // Extract all keys from the port definition map (exhaustive over BlueprintNodeType)
      const portTypes = Object.keys(BLUEPRINT_NODE_PORTS) as BlueprintNodeType[];
      expect(portTypes.sort()).toEqual([...ALLOWED_NODE_TYPES].sort());
    });

    it('does not include any Director-specific node types', () => {
      const portTypes = Object.keys(BLUEPRINT_NODE_PORTS) as string[];
      for (const prohibited of PROHIBITED_NODE_TYPES) {
        expect(portTypes).not.toContain(prohibited);
      }
    });

    it('registers an executor for every declared node type', () => {
      const portTypes = Object.keys(BLUEPRINT_NODE_PORTS) as BlueprintNodeType[];
      for (const nodeType of portTypes) {
        expect(NODE_EXECUTORS[nodeType]).toBeDefined();
      }
    });

    it('does not register executors for Director/S-Class node types', () => {
      for (const prohibited of PROHIBITED_NODE_TYPES) {
        expect(NODE_EXECUTORS[prohibited]).toBeUndefined();
      }
    });
  });

  describe('BlueprintSourceKind supports backward-compatibility director-scene', () => {
    it('includes director-scene as a valid source kind for backward compatibility', () => {
      // director-scene is needed for reading old Director data,
      // but must NOT route through Director API for generation.
      const validSourceKinds: BlueprintSourceKind[] = [
        'shot',
        'scene',
        'character',
        'director-scene',
        'media',
      ];
      // Verify the type compiles with all expected values
      expect(validSourceKinds).toHaveLength(5);
    });
  });

  describe('Generator executors use Freedom API exclusively', () => {
    it('image-generator executor is registered', () => {
      expect(NODE_EXECUTORS['image-generator']).toBeDefined();
    });

    it('video-generator executor is registered', () => {
      expect(NODE_EXECUTORS['video-generator']).toBeDefined();
    });

    it('no Director or S-Class generator executors are registered', () => {
      const executorKeys = Object.keys(NODE_EXECUTORS);
      expect(executorKeys).not.toContain('director-generator');
      expect(executorKeys).not.toContain('sclass-generator');
      expect(executorKeys).not.toContain('storyboard-grid');
    });
  });

  describe('Port definitions enforce clean boundary', () => {
    it('image-generator ports are self-contained (prompt + reference-images → image)', () => {
      const ports = BLUEPRINT_NODE_PORTS['image-generator'];
      const inputPorts = ports.filter((p) => p.direction === 'input');
      const outputPorts = ports.filter((p) => p.direction === 'output');

      expect(inputPorts.map((p) => p.id).sort()).toEqual(['prompt', 'reference-images']);
      expect(outputPorts.map((p) => p.id)).toEqual(['image']);
    });

    it('video-generator ports are self-contained (prompt + reference-media → video)', () => {
      const ports = BLUEPRINT_NODE_PORTS['video-generator'];
      const inputPorts = ports.filter((p) => p.direction === 'input');
      const outputPorts = ports.filter((p) => p.direction === 'output');

      expect(inputPorts.map((p) => p.id).sort()).toEqual(['prompt', 'reference-media']);
      expect(outputPorts.map((p) => p.id)).toEqual(['video']);
    });

    it('output port accepts image/video/audio (not Director-specific types)', () => {
      const ports = BLUEPRINT_NODE_PORTS['output'];
      const mediaPort = ports.find((p) => p.id === 'media');
      expect(mediaPort).toBeDefined();
      expect(mediaPort!.dataTypes).toEqual(['image', 'video', 'audio']);
    });

    it('no port references Director-specific data types', () => {
      const allPorts = Object.values(BLUEPRINT_NODE_PORTS).flat();
      for (const port of allPorts) {
        for (const dataType of port.dataTypes) {
          expect(dataType).not.toBe('director-scene');
          expect(dataType).not.toBe('sclass-group');
          expect(dataType).not.toBe('storyboard-grid');
        }
      }
    });
  });

  describe('Director-to-Blueprint adapter respects boundary (§10.3)', () => {
    const sampleScene = {
      id: 1,
      sceneName: '测试场景',
      sceneLocation: '测试地点',
      imagePrompt: 'A test image',
      imagePromptZh: '测试图片',
      videoPrompt: 'A test video',
      videoPromptZh: '测试视频',
      dialogue: '',
      actionSummary: '',
      shotSize: '中景' as const,
      duration: '5s' as const,
      characterIds: [],
    };

    it('creates only standard blueprint node types (no Director-specific types)', () => {
      const result = convertDirectorToBlueprint({
        projectId: 'test',
        scenes: [sampleScene],
      });

      for (const node of result.blueprint.nodes) {
        expect(ALLOWED_NODE_TYPES).toContain(node.data.nodeType);
        for (const prohibited of PROHIBITED_NODE_TYPES) {
          expect(node.data.nodeType).not.toBe(prohibited);
        }
      }
    });

    it('uses director-scene sourceRef kind for legacy traceability', () => {
      const result = convertDirectorToBlueprint({
        projectId: 'test',
        scenes: [sampleScene],
        sourceVersion: '20260101',
      });

      for (const node of result.blueprint.nodes) {
        expect(node.data.sourceRef).toBeDefined();
        expect(node.data.sourceRef!.kind).toBe('director-scene');
      }
    });

    it('does NOT create director-specific executor types', () => {
      const result = convertDirectorToBlueprint({
        projectId: 'test',
        scenes: [sampleScene],
      });

      const nodeTypes = result.blueprint.nodes.map((n) => n.data.nodeType);
      expect(nodeTypes).not.toContain('director-scene');
      expect(nodeTypes).not.toContain('director-generator');
      expect(nodeTypes).not.toContain('sclass-group');
      expect(nodeTypes).not.toContain('sclass-generator');
    });

    it('all generated nodes have registered executors', () => {
      const result = convertDirectorToBlueprint({
        projectId: 'test',
        scenes: [sampleScene],
      });

      for (const node of result.blueprint.nodes) {
        expect(NODE_EXECUTORS[node.data.nodeType]).toBeDefined();
      }
    });
  });

  describe('Legacy Director sourceRef validation (§10.3)', () => {
    it('detects nodes with director-scene sourceRef', () => {
      const result = convertDirectorToBlueprint({
        projectId: 'test',
        scenes: [{
          id: 1,
          sceneName: '场景A',
          sceneLocation: '地点A',
          imagePrompt: 'prompt',
          imagePromptZh: '',
          videoPrompt: '',
          videoPromptZh: '',
          dialogue: '',
          actionSummary: '',
          shotSize: null,
          duration: '5s',
          characterIds: [],
        }],
      });

      const diagnostics = validateLegacyDirectorSourceRefs(result.blueprint);
      // Each node should get a warning
      expect(diagnostics.length).toBe(result.blueprint.nodes.length);
      expect(diagnostics.every(
        (d) => d.code === BLUEPRINT_DIAGNOSTIC_CODES.directorSceneLegacyNode,
      )).toBe(true);
      expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    });

    it('returns no diagnostics for blueprint without director-scene sourceRef', () => {
      // A blueprint with shot-type sourceRefs
      const emptyBlueprint = {
        id: 'bp-1',
        projectId: 'test',
        name: 'test',
        version: 1,
        nodes: [{
          id: 'n1',
          type: 'text-input' as const,
          position: { x: 0, y: 0 },
          data: {
            nodeType: 'text-input' as const,
            label: 'test',
            config: { text: 'hello' },
            sourceRef: { kind: 'shot' as const, id: 'shot-1' },
          },
        }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        status: 'draft' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const diagnostics = validateLegacyDirectorSourceRefs(emptyBlueprint);
      expect(diagnostics).toHaveLength(0);
    });
  });
});
