// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import {
  BLUEPRINT_SCHEMA_VERSION,
  type BlueprintProject,
  type BlueprintProjectCollection,
  type BlueprintNode,
  type BlueprintEdge,
  type BlueprintNodeType,
  type BlueprintMediaRef,
} from '@/types/blueprint';
import { isBlueprintNodeType, isLegacyBlueprintNodeType } from './blueprint-schema';

// ─── Persisted types ────────────────────────────────────────────

export interface PersistedBlueprintState extends BlueprintProjectCollection {
  schemaVersion: number;
}

// ─── Default factories ──────────────────────────────────────────

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'draft',
  'ready',
  'running',
  'completed',
  'archived',
]);

function isValidStatus(s: unknown): s is BlueprintProject['status'] {
  return typeof s === 'string' && VALID_STATUSES.has(s);
}

function defaultViewport() {
  return { x: 0, y: 0, zoom: 1 };
}

function defaultNodeData(nodeType: BlueprintNodeType) {
  const base: Record<string, unknown> = {
    nodeType,
    label: nodeType,
    config: {},
  };
  if (nodeType === 'text-box') {
    base.config = { text: '' };
  } else if (nodeType === 'image-box') {
    base.config = { mode: 'upload', media: [] };
  } else if (nodeType === 'video-box') {
    base.config = { mode: 'upload', media: [] };
  } else if (nodeType === 'script-import') {
    base.config = { selectedShotIds: [], mode: 'snapshot' };
  } else if (nodeType === 'output') {
    base.config = { acceptedTypes: ['image'] };
  }
  return base;
}

// ─── Per-node migration ─────────────────────────────────────────

/**
 * Map a legacy (v1) node type to its v2 equivalent.
 * Returns the input unchanged if it's already a v2 type.
 */
function mapLegacyNodeType(rawType: string): BlueprintNodeType {
  switch (rawType) {
    case 'text-input':
      return 'text-box';
    case 'image-reference':
    case 'image-generator':
      return 'image-box';
    case 'video-reference':
    case 'video-generator':
      return 'video-box';
    case 'script-import':
    case 'output':
      return rawType as BlueprintNodeType;
    default:
      return isBlueprintNodeType(rawType) ? rawType : 'text-box';
  }
}

/**
 * Migrate a v1 node's config to v2 format based on the legacy type.
 */
function migrateNodeConfig(
  legacyType: string,
  config: Record<string, unknown>,
  output: unknown,
): Record<string, unknown> {
  switch (legacyType) {
    case 'text-input':
      // text-input → text-box: config is compatible as-is, ensure text field
      return { text: '', ...config };
    case 'image-reference':
      // image-reference → image-box (upload mode)
      return {
        mode: 'upload',
        media: Array.isArray(config.media) ? config.media : [],
      };
    case 'image-generator':
      // image-generator → image-box (generate mode)
      return {
        mode: 'generate',
        media: output
          ? (Array.isArray(output) ? output : [output]).filter(
              (r): r is BlueprintMediaRef =>
                typeof r === 'object' && r !== null && 'url' in r,
            )
          : [],
        generation: { ...config },
      };
    case 'video-reference':
      // video-reference → video-box (upload mode)
      return {
        mode: 'upload',
        media: Array.isArray(config.media) ? config.media : [],
      };
    case 'video-generator':
      // video-generator → video-box (generate mode)
      return {
        mode: 'generate',
        media: output
          ? (Array.isArray(output) ? output : [output]).filter(
              (r): r is BlueprintMediaRef =>
                typeof r === 'object' && r !== null && 'url' in r,
            )
          : [],
        generation: { ...config },
      };
    default:
      return config;
  }
}

/**
 * Normalize a single blueprint node, ensuring all required data fields exist.
 * Invalid nodeTypes fall back to 'text-box' to preserve the node in the graph.
 * Legacy v1 types are mapped to v2 types with config migration.
 */
export function migrateBlueprintNode(node: unknown): BlueprintNode {
  if (!node || typeof node !== 'object') {
    return {
      id: 'unknown',
      type: 'text-box',
      position: { x: 0, y: 0 },
      data: defaultNodeData('text-box') as BlueprintNode['data'],
    };
  }

  const n = node as Record<string, unknown>;
  const id = typeof n.id === 'string' ? n.id : 'unknown';
  const rawType = typeof n.type === 'string' ? n.type : 'text-box';

  // Map legacy types to v2 types
  const nodeType: BlueprintNodeType = isLegacyBlueprintNodeType(rawType)
    ? mapLegacyNodeType(rawType)
    : isBlueprintNodeType(rawType)
      ? rawType
      : 'text-box';

  const position =
    n.position && typeof n.position === 'object'
      ? {
          x: typeof (n.position as Record<string, unknown>).x === 'number'
            ? ((n.position as Record<string, unknown>).x as number)
            : 0,
          y: typeof (n.position as Record<string, unknown>).y === 'number'
            ? ((n.position as Record<string, unknown>).y as number)
            : 0,
        }
      : { x: 0, y: 0 };

  // Normalize data
  const rawData = n.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : {};
  const data: Record<string, unknown> = { ...rawData };

  // Migrate config if this is a legacy type
  const rawConfig =
    data.config && typeof data.config === 'object'
      ? (data.config as Record<string, unknown>)
      : {};
  if (isLegacyBlueprintNodeType(rawType)) {
    data.config = migrateNodeConfig(rawType, rawConfig, data.output);
  }

  if (typeof data.nodeType !== 'string' || !isBlueprintNodeType(data.nodeType)) {
    data.nodeType = nodeType;
  }
  if (typeof data.label !== 'string') {
    data.label = String(data.nodeType);
  }
  if (!data.config || typeof data.config !== 'object') {
    data.config = defaultNodeData(data.nodeType as BlueprintNodeType).config;
  }

  return {
    id,
    type: nodeType,
    position,
    data: data as BlueprintNode['data'],
    ...(typeof n.sourcePosition === 'string' ? { sourcePosition: n.sourcePosition } : {}),
    ...(typeof n.targetPosition === 'string' ? { targetPosition: n.targetPosition } : {}),
    ...(typeof n.hidden === 'boolean' ? { hidden: n.hidden } : {}),
    ...(typeof n.selected === 'boolean' ? { selected: n.selected } : {}),
    ...(typeof n.draggable === 'boolean' ? { draggable: n.draggable } : {}),
    ...(typeof n.selectable === 'boolean' ? { selectable: n.selectable } : {}),
    ...(typeof n.connectable === 'boolean' ? { connectable: n.connectable } : {}),
    ...(typeof n.deletable === 'boolean' ? { deletable: n.deletable } : {}),
    ...(typeof n.dragging === 'boolean' ? { dragging: n.dragging } : {}),
  } as BlueprintNode;
}

// ─── Per-edge migration ─────────────────────────────────────────

/**
 * Normalize a single blueprint edge, ensuring required fields exist.
 */
export function migrateBlueprintEdge(edge: unknown): BlueprintEdge {
  if (!edge || typeof edge !== 'object') {
    return {
      id: 'unknown',
      source: '',
      target: '',
      type: 'blueprint',
      data: { dataType: 'text' },
    };
  }

  const e = edge as Record<string, unknown>;
  const id = typeof e.id === 'string' ? e.id : 'unknown';
  const source = typeof e.source === 'string' ? e.source : '';
  const target = typeof e.target === 'string' ? e.target : '';

  const rawData = e.data && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : {};
  const data: Record<string, unknown> = { ...rawData };
  if (typeof data.dataType !== 'string') {
    data.dataType = 'text';
  }

  const result: Record<string, unknown> = {
    id,
    source,
    target,
    type: typeof e.type === 'string' ? e.type : 'blueprint',
    data,
  };
  if (typeof e.sourceHandle === 'string') result.sourceHandle = e.sourceHandle;
  if (typeof e.targetHandle === 'string') result.targetHandle = e.targetHandle;
  if (typeof e.animated === 'boolean') result.animated = e.animated;

  return result as unknown as BlueprintEdge;
}

// ─── Per-document migration ─────────────────────────────────────

/**
 * Migrate a single blueprint document (BlueprintProject).
 * Ensures all required top-level fields exist and nodes/edges are normalized.
 */
export function migrateBlueprintDocument(doc: unknown): BlueprintProject {
  if (!doc || typeof doc !== 'object') {
    const now = Date.now();
    return {
      id: 'unknown',
      projectId: '',
      name: 'Untitled',
      version: BLUEPRINT_SCHEMA_VERSION,
      nodes: [],
      edges: [],
      viewport: defaultViewport(),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
  }

  const d = doc as Record<string, unknown>;
  const now = Date.now();

  const id = typeof d.id === 'string' ? d.id : 'unknown';
  const projectId = typeof d.projectId === 'string' ? d.projectId : '';
  const name = typeof d.name === 'string' ? d.name : 'Untitled';
  const status = isValidStatus(d.status) ? d.status : 'draft';
  const createdAt = typeof d.createdAt === 'number' ? d.createdAt : now;
  const updatedAt = typeof d.updatedAt === 'number' ? d.updatedAt : now;

  // Viewport normalization
  let viewport = defaultViewport();
  if (d.viewport && typeof d.viewport === 'object') {
    const vp = d.viewport as Record<string, unknown>;
    viewport = {
      x: typeof vp.x === 'number' ? vp.x : 0,
      y: typeof vp.y === 'number' ? vp.y : 0,
      zoom: typeof vp.zoom === 'number' ? vp.zoom : 1,
    };
  }

  // Nodes & edges normalization
  const rawNodes = Array.isArray(d.nodes) ? d.nodes : [];
  const rawEdges = Array.isArray(d.edges) ? d.edges : [];
  const nodes = rawNodes.map(migrateBlueprintNode);
  const edges = rawEdges.map(migrateBlueprintEdge);

  // Edge validity: source and target must reference existing nodes
  const nodeIds = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );

  const result: BlueprintProject = {
    id,
    projectId,
    name,
    version: BLUEPRINT_SCHEMA_VERSION,
    nodes,
    edges: validEdges,
    viewport,
    status,
    createdAt,
    updatedAt,
  };
  if (typeof d.sourceScriptVersion === 'string') {
    result.sourceScriptVersion = d.sourceScriptVersion;
  }
  return result;
}

// ─── Version migration steps ────────────────────────────────────

/**
 * Apply per-version migration steps to a blueprint document.
 * Each version step transforms the document in-place for that version.
 *
 * When bumping BLUEPRINT_SCHEMA_VERSION to N, add:
 *   if (fromVersion < N) { ... apply v(N-1)→vN transform ... }
 */
function applyVersionMigrations(
  doc: BlueprintProject,
  fromVersion: number,
): BlueprintProject {
  let migrated = doc;

  // v1 → v2: legacy types are already handled by migrateBlueprintNode
  // (type mapping + config migration). Here we do a post-pass to spread
  // overlapping nodes caused by the larger v2 box dimensions.
  if (fromVersion < 2) {
    migrated = spreadOverlappingNodes(migrated);
  }

  // Always stamp to current version
  migrated = { ...migrated, version: BLUEPRINT_SCHEMA_VERSION };
  return migrated;
}

/**
 * Spread nodes that may overlap due to v1→v2 dimension changes.
 * Groups by node type and offsets each node by y+40 within its group.
 */
function spreadOverlappingNodes(doc: BlueprintProject): BlueprintProject {
  // Build a position fingerprint map to detect exact overlaps
  const posCount = new Map<string, number>();
  for (const node of doc.nodes) {
    const key = `${Math.round(node.position.x)},${Math.round(node.position.y)}`;
    posCount.set(key, (posCount.get(key) ?? 0) + 1);
  }

  // If no overlaps, return unchanged
  let hasOverlaps = false;
  for (const count of posCount.values()) {
    if (count > 1) { hasOverlaps = true; break; }
  }
  if (!hasOverlaps) return doc;

  // Spread overlapping nodes by offsetting y within same-type groups
  const seen = new Map<string, number>();
  const nodes = doc.nodes.map((node) => {
    const key = `${Math.round(node.position.x)},${Math.round(node.position.y)}`;
    const count = posCount.get(key) ?? 0;
    if (count <= 1) return node;

    const groupKey = `${node.data.nodeType}:${key}`;
    const idx = seen.get(groupKey) ?? 0;
    seen.set(groupKey, idx + 1);

    return {
      ...node,
      position: {
        ...node.position,
        y: node.position.y + idx * 40,
      },
    };
  });

  return { ...doc, nodes };
}

// ─── Top-level migration entry point ────────────────────────────

/**
 * Migrates persisted blueprint state from any known version to the current
 * schema version. Called by zustand's persist middleware `migrate` callback
 * and also during `merge` for double safety.
 *
 * Version history:
 *   v1 — Initial schema (2026-07): nodes, edges, viewport, status, timestamps.
 *        Migration normalizes missing fields and invalid data defensively.
 *
 * @param persistedState  Raw deserialized state from storage (may be any shape).
 * @param persistedVersion  The version number stored alongside the data.
 */
export function migrateBlueprintState(
  persistedState: unknown,
  persistedVersion: number,
): PersistedBlueprintState {
  // ── Guard: completely missing or non-object ──
  if (!persistedState || typeof persistedState !== 'object') {
    return {
      schemaVersion: BLUEPRINT_SCHEMA_VERSION,
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: [],
    };
  }

  const state = persistedState as Record<string, unknown>;
  const activeProjectId =
    typeof state.activeProjectId === 'string' ? state.activeProjectId : '';
  const activeBlueprintId =
    typeof state.activeBlueprintId === 'string' ? state.activeBlueprintId : null;

  // ── Migrate each blueprint document ──
  const rawBlueprints = Array.isArray(state.blueprints) ? state.blueprints : [];
  let blueprints: BlueprintProject[] = rawBlueprints.map((raw) => {
    const doc = migrateBlueprintDocument(raw);
    // Apply per-version transforms (v1→v2, v2→v3, etc.)
    const fromVersion =
      raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).version === 'number'
        ? ((raw as Record<string, unknown>).version as number)
        : 0;
    return applyVersionMigrations(doc, fromVersion);
  });

  // ── Future: top-level state transforms per version ──
  // if (persistedVersion < 2) {
  //   blueprints = blueprints.map(bp => ({ ...bp, newField: defaultValue }));
  // }

  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    activeProjectId,
    activeBlueprintId,
    blueprints,
  };
}
