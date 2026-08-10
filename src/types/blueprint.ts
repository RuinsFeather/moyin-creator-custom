// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { Edge, Node, Viewport } from '@xyflow/react';
import type {
  FreedomImageParams,
  FreedomServerTaskInfo,
  FreedomVideoUploadRole,
  FreedomVideoParams,
} from '@/lib/freedom/freedom-api';

/**
 * 当前蓝图 schema 版本号。
 *
 * §12.4 决策：不单独维护蓝图版本号，而是与软件版本同步派生
 * （见 `src/lib/blueprint/schema-version.ts`）。每次软件发版蓝图版本
 * 自动变化，zustand persist 检测到版本不匹配即触发 migrate。
 */
export { BLUEPRINT_SCHEMA_VERSION } from '@/lib/blueprint/schema-version';

/**
 * All blueprint node types.
 *
 * ── Generation Chain Boundary (§9.3) ──────────────────────────────
 * This union is intentionally closed. Director and S-Class specific
 * node types (e.g. director-scene, sclass-group) must NOT be added
 * here. If Director integration is needed, create a separate adapter
 * node type that reads SplitScene data through an explicit bridge,
 * not by embedding Director API calls in blueprint executors.
 *
 * Storyboard-specific features (grid images, joint images, scene
 * splitting) also must NOT be represented as blueprint node types.
 * ─────────────────────────────────────────────────────────────────
 */
export type BlueprintNodeType =
  | 'text-input'
  | 'image-reference'
  | 'video-reference'
  | 'script-import'
  | 'image-generator'
  | 'video-generator'
  | 'output';

export type BlueprintDataType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'context';

export type BlueprintPortDirection = 'input' | 'output';

export interface BlueprintPortDefinition {
  id: string;
  direction: BlueprintPortDirection;
  dataTypes: readonly BlueprintDataType[];
  required?: boolean;
  multiple?: boolean;
}

/**
 * Stable port contract used by the editor, graph validator and executor.
 * Handles must be persisted explicitly on edges; an omitted handle is invalid.
 */
export const BLUEPRINT_NODE_PORTS = {
  'text-input': [
    { id: 'text', direction: 'output', dataTypes: ['text'] },
  ],
  'image-reference': [
    { id: 'image', direction: 'output', dataTypes: ['image'] },
  ],
  'video-reference': [
    { id: 'video', direction: 'output', dataTypes: ['video'] },
  ],
  'script-import': [
    { id: 'context', direction: 'output', dataTypes: ['context'] },
  ],
  'image-generator': [
    {
      id: 'prompt',
      direction: 'input',
      dataTypes: ['text', 'context'],
      multiple: true,
    },
    {
      id: 'reference-images',
      direction: 'input',
      dataTypes: ['image'],
      multiple: true,
    },
    { id: 'image', direction: 'output', dataTypes: ['image'] },
  ],
  'video-generator': [
    {
      id: 'prompt',
      direction: 'input',
      dataTypes: ['text', 'context'],
      multiple: true,
    },
    {
      id: 'reference-media',
      direction: 'input',
      dataTypes: ['image', 'video', 'audio'],
      multiple: true,
    },
    { id: 'video', direction: 'output', dataTypes: ['video'] },
  ],
  output: [
    {
      id: 'media',
      direction: 'input',
      dataTypes: ['image', 'video', 'audio'],
      multiple: true,
    },
  ],
} as const satisfies Record<BlueprintNodeType, readonly BlueprintPortDefinition[]>;

/**
 * Source reference kinds for tracing blueprint nodes back to their origin.
 *
 * `'director-scene'` is a backward-compatibility kind for reading old
 * Director data. New imports should prefer `'shot'` or `'media'`.
 * Director-specific generation capabilities must NOT be routed through
 * Freedom API — use Director's own parameter/state chain instead.
 */
export type BlueprintSourceKind =
  | 'shot'
  | 'scene'
  | 'character'
  | 'director-scene'
  | 'media';

export interface BlueprintSourceRef {
  kind: BlueprintSourceKind;
  id: string;
  sourceVersion?: string;
}

export type BlueprintJsonPrimitive = string | number | boolean | null;
export type BlueprintJsonValue =
  | BlueprintJsonPrimitive
  | BlueprintJsonValue[]
  | { [key: string]: BlueprintJsonValue };
export type BlueprintJsonObject = { [key: string]: BlueprintJsonValue };

/**
 * Small, serializable source snapshot. It must contain metadata and prompt-like
 * values only; binary data, base64 strings and full media files are prohibited.
 */
export interface BlueprintSourceSnapshot {
  kind: BlueprintSourceKind;
  sourceId: string;
  sourceVersion: string;
  capturedAt: number;
  data: BlueprintJsonObject;
}

/** A stable media reference. Binary or base64 content must not be persisted here. */
export interface BlueprintMediaRef {
  mediaId?: string;
  url?: string;
  localPath?: string;
  mimeType?: string;
  taskId?: string;
  /** Stable result key used to make media finalization idempotent. */
  dedupeKey?: string;
  /** Volcengine asset ID (e.g. `Asset-2026...`), after "一键上传到素材资产"。 */
  assetId?: string;
  /** Volcengine asset URI (e.g. `Asset://<assetId>`), passed straight to the API. */
  volcAssetUri?: string;
}

export type BlueprintNodeStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stale'
  | 'blocked';

export type BlueprintTaskRef = Pick<
  FreedomServerTaskInfo,
  'taskId' | 'route' | 'pollUrl' | 'model'
> & {
  /** Optional provider-specific alias when it differs from taskId. */
  serverTaskId?: string;
};

export interface BlueprintNodeExecution {
  status: BlueprintNodeStatus;
  progress?: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  runId?: string;
  task?: BlueprintTaskRef;
  output?: BlueprintMediaRef | BlueprintMediaRef[];
}

export interface TextInputNodeConfig {
  text: string;
}

export interface MediaReferenceNodeConfig {
  media: BlueprintMediaRef[];
}

export interface ScriptImportNodeConfig {
  selectedShotIds: string[];
  mode: 'snapshot';
}

type BlueprintImageGeneratorOptions = Omit<
  FreedomImageParams,
  | 'prompt'
  | 'projectId'
  | 'referenceImages'
  | 'extraParams'
  | 'onProgress'
  | 'signal'
>;

/** Persisted config; reference image bytes are resolved from media refs later. */
export interface BlueprintImageGeneratorConfig extends BlueprintImageGeneratorOptions {
  prompt?: string;
  referenceImageRefs?: BlueprintMediaRef[];
  extraParams?: BlueprintJsonObject;
}

type BlueprintVideoGeneratorOptions = Omit<
  FreedomVideoParams,
  | 'prompt'
  | 'projectId'
  | 'uploadFiles'
  | 'onTaskCreated'
  | 'signal'
>;

export interface BlueprintVideoReference extends BlueprintMediaRef {
  role: FreedomVideoUploadRole;
  assetType?: 'image' | 'video' | 'audio';
}

/** Persisted config; upload data URLs are resolved from media refs later. */
export interface BlueprintVideoGeneratorConfig extends BlueprintVideoGeneratorOptions {
  prompt?: string;
  referenceMediaRefs?: BlueprintVideoReference[];
}

export interface OutputNodeConfig {
  acceptedTypes: Array<'image' | 'video' | 'audio'>;
}

export type BlueprintNodeConfig =
  | TextInputNodeConfig
  | MediaReferenceNodeConfig
  | ScriptImportNodeConfig
  | BlueprintImageGeneratorConfig
  | BlueprintVideoGeneratorConfig
  | OutputNodeConfig;

/** React Flow node data. The index signature satisfies its Record constraint. */
export interface BlueprintNodeData {
  [key: string]: unknown;
  nodeType: BlueprintNodeType;
  label: string;
  config: BlueprintNodeConfig;
  sourceRef?: BlueprintSourceRef;
  sourceSnapshot?: BlueprintSourceSnapshot;
  output?: BlueprintMediaRef | BlueprintMediaRef[];
  execution?: BlueprintNodeExecution;
}

export type BlueprintNode = Node<BlueprintNodeData, BlueprintNodeType>;

/** Port type metadata persisted with a React Flow edge. */
export interface BlueprintEdgeData {
  [key: string]: unknown;
  dataType: BlueprintDataType;
  required?: boolean;
  /** Lower values are merged first; equal values fall back to edge ID order. */
  order?: number;
}

export type BlueprintEdge = Edge<BlueprintEdgeData, 'blueprint'>;

export interface BlueprintProject {
  id: string;
  projectId: string;
  name: string;
  version: number;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  viewport: Viewport;
  status: 'draft' | 'ready' | 'running' | 'completed' | 'archived';
  createdAt: number;
  updatedAt: number;
  sourceScriptVersion?: string;
}

export interface BlueprintProjectCollection {
  activeProjectId: string;
  activeBlueprintId: string | null;
  blueprints: BlueprintProject[];
}

/** Copying preserves document/media references but always resets execution state. */
export interface BlueprintCopyPolicy {
  preserveSourceSnapshots: true;
  preserveMediaReferences: true;
  resetExecutionState: true;
  regenerateBlueprintId: true;
  regenerateNodeAndEdgeIds: true;
}

export const BLUEPRINT_COPY_POLICY: BlueprintCopyPolicy = {
  preserveSourceSnapshots: true,
  preserveMediaReferences: true,
  resetExecutionState: true,
  regenerateBlueprintId: true,
  regenerateNodeAndEdgeIds: true,
};
