// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Blueprint Input Merge Rules
//
// Defines how multiple upstream outputs are merged before being passed to
// generator nodes. The rules cover:
//   1. Text concatenation: multiple text/context upstreams → single prompt.
//   2. Reference image ordering: upstream image outputs → referenceImages[].
//   3. Video upload file roles: upstream media → uploadFiles[] with roles.
//   4. Missing upstream strategy: block / skip / use node config fallback.
//   5. Stale propagation: which downstream nodes become stale when an output
//      is replaced.

import type {
  BlueprintEdge,
  BlueprintNode,
  BlueprintMediaRef,
  BlueprintImageGeneratorConfig,
  BlueprintVideoGeneratorConfig,
  BlueprintVideoReference,
} from '@/types/blueprint';
import type { NodeExecutorOutput } from './node-executors';

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Strategy when an upstream node's output is missing (e.g., skipped or failed
 * but not blocked — the edge exists but no output was produced).
 */
export type MissingUpstreamStrategy = 'block' | 'skip' | 'use-config';

/**
 * A resolved video upload file, ready to pass to generateFreedomVideo.
 * Mirrors `FreedomVideoUploadFile` but does not import it directly to keep
 * this module testable without the Freedom API dependency.
 */
export interface ResolvedVideoUploadFile {
  role: 'single' | 'first' | 'last' | 'reference';
  dataUrl: string;
  fileName?: string;
  mimeType?: string;
  assetType?: 'image' | 'video' | 'audio';
  /** Volcengine asset URI (e.g. `Asset://<assetId>`). When set, the API can
   *  reference the already-uploaded asset instead of re-uploading dataUrl. */
  volcAssetUri?: string;
}

// ── Edge ordering ─────────────────────────────────────────────────────────

interface RankedEdge {
  edgeId: string;
  source: string;
  order: number;
}

/**
 * Rank edges connected to a node's port by their `order` field, breaking ties
 * by edge ID lexicographic order.
 */
function rankEdges(
  targetNodeId: string,
  targetHandle: string,
  edges: BlueprintEdge[],
  validSources: Set<string>,
): RankedEdge[] {
  const ranked: RankedEdge[] = [];
  for (const edge of edges) {
    if (edge.target !== targetNodeId) continue;
    if (targetHandle && edge.targetHandle !== targetHandle) continue;
    if (!validSources.has(edge.source)) continue;
    ranked.push({
      edgeId: edge.id,
      source: edge.source,
      order: edge.data?.order ?? 0,
    });
  }
  ranked.sort((a, b) => a.order - b.order || a.edgeId.localeCompare(b.edgeId));
  return ranked;
}

// ── 1. Text merge ─────────────────────────────────────────────────────────

/**
 * Merge multiple upstream text/context outputs into a single prompt string.
 *
 * Ordering:
 *   - Edges are sorted by `edge.data.order` (ascending), then by edge ID.
 *   - Each upstream output's data is stringified and trimmed.
 *   - Non-empty segments are joined with "\n\n" (double newline).
 *
 * Returns the merged prompt, or an empty string if no upstreams produce text.
 */
export function mergePromptText(
  nodeId: string,
  edges: BlueprintEdge[],
  upstreamOutputs: Map<string, NodeExecutorOutput>,
): string {
  // Gather all text/context upstream sources
  const textSources = new Set<string>();
  for (const [id, output] of upstreamOutputs) {
    const data = output.data;
    if (typeof data === 'string') {
      textSources.add(id);
    }
  }

  const ranked = rankEdges(nodeId, 'prompt', edges, textSources);
  const segments: string[] = [];

  for (const { source } of ranked) {
    const output = upstreamOutputs.get(source);
    if (!output) continue;
    const text = typeof output.data === 'string' ? output.data.trim() : '';
    if (text) segments.push(text);
  }

  return segments.join('\n\n');
}

// ── 2. Reference image collection ─────────────────────────────────────────

/**
 * Collect reference images from upstream outputs, preserving edge order.
 *
 * Sources:
 *   - Upstream image-reference nodes produce `BlueprintMediaRef[]` arrays.
 *   - Upstream image-generator nodes produce a single `{ url, mimeType }`.
 *
 * The optional `maxCount` parameter caps the number of images returned
 * (default: 10, matching the Freedom API limit).
 *
 * Returns an array of URL strings suitable for `generateFreedomImage.referenceImages`.
 */
export function collectReferenceImages(
  nodeId: string,
  edges: BlueprintEdge[],
  upstreamOutputs: Map<string, NodeExecutorOutput>,
  maxCount = 10,
): string[] {
  // Gather image-type upstream sources
  const imageSources = new Set<string>();
  for (const [id, output] of upstreamOutputs) {
    if (Array.isArray(output.data)) {
      imageSources.add(id);
    } else if (
      output.data &&
      typeof output.data === 'object' &&
      'url' in output.data
    ) {
      imageSources.add(id);
    }
  }

  const ranked = rankEdges(nodeId, 'reference-images', edges, imageSources);
  const urls: string[] = [];

  for (const { source } of ranked) {
    if (urls.length >= maxCount) break;
    const output = upstreamOutputs.get(source);
    if (!output) continue;

    if (Array.isArray(output.data)) {
      for (const item of output.data) {
        if (urls.length >= maxCount) break;
        if (item && typeof item === 'object' && 'url' in item && typeof item.url === 'string') {
          urls.push(item.url);
        }
      }
    } else if (
      output.data &&
      typeof output.data === 'object' &&
      'url' in output.data &&
      typeof (output.data as { url: string }).url === 'string'
    ) {
      urls.push((output.data as { url: string }).url);
    }
  }

  // Also include inline referenceImageRefs from config
  // (These are lower priority than upstream outputs — appended at the end.)

  return urls;
}

/**
 * Collect reference images as `BlueprintMediaRef[]` for persistence.
 * Same ordering as `collectReferenceImages` but returns full refs.
 */
export function collectReferenceImageRefs(
  nodeId: string,
  edges: BlueprintEdge[],
  upstreamOutputs: Map<string, NodeExecutorOutput>,
  maxCount = 10,
): BlueprintMediaRef[] {
  const imageSources = new Set<string>();
  for (const [id, output] of upstreamOutputs) {
    if (Array.isArray(output.data)) {
      imageSources.add(id);
    } else if (
      output.data &&
      typeof output.data === 'object' &&
      'url' in output.data
    ) {
      imageSources.add(id);
    }
  }

  const ranked = rankEdges(nodeId, 'reference-images', edges, imageSources);
  const refs: BlueprintMediaRef[] = [];

  for (const { source } of ranked) {
    if (refs.length >= maxCount) break;
    const output = upstreamOutputs.get(source);
    if (!output) continue;

    if (Array.isArray(output.data)) {
      for (const item of output.data) {
        if (refs.length >= maxCount) break;
        if (item && typeof item === 'object' && 'url' in item && typeof item.url === 'string') {
          refs.push({
            url: item.url,
            mimeType: (item as { mimeType?: string }).mimeType,
          });
        }
      }
    } else if (
      output.data &&
      typeof output.data === 'object' &&
      'url' in output.data &&
      typeof (output.data as { url: string }).url === 'string'
    ) {
      const d = output.data as { url: string; mimeType?: string };
      refs.push({ url: d.url, mimeType: d.mimeType });
    }
  }

  return refs;
}

// ── 3. Video upload file collection ───────────────────────────────────────

/**
 * Collect upstream media and map to `uploadFiles` roles for video generation.
 *
 * Role assignment logic:
 *   - If a `BlueprintVideoReference` has an explicit `role`, use it.
 *   - If the upstream is from the `reference-media` port:
 *     - A single image with no explicit role → `'first'` (first frame).
 *     - Multiple items: first → `'first'`, last → `'last'`, middle → `'reference'`.
 *     - Videos → `'reference'`.
 *   - Config-level `referenceMediaRefs` are appended after upstream (with their explicit roles).
 *
 * Returns an array of `ResolvedVideoUploadFile` objects.
 */
export function collectVideoUploadFiles(
  nodeId: string,
  edges: BlueprintEdge[],
  upstreamOutputs: Map<string, NodeExecutorOutput>,
  configRefMedia?: BlueprintVideoReference[],
): ResolvedVideoUploadFile[] {
  const mediaSources = new Set<string>();
  for (const [id, output] of upstreamOutputs) {
    if (Array.isArray(output.data)) {
      mediaSources.add(id);
    } else if (
      output.data &&
      typeof output.data === 'object' &&
      'url' in output.data
    ) {
      mediaSources.add(id);
    }
  }

  const ranked = rankEdges(nodeId, 'reference-media', edges, mediaSources);
  const files: ResolvedVideoUploadFile[] = [];

  for (const { source } of ranked) {
    const output = upstreamOutputs.get(source);
    if (!output) continue;

    const items: Array<{ url: string; mimeType?: string; role?: string; volcAssetUri?: string }> = [];

    if (Array.isArray(output.data)) {
      for (const item of output.data) {
        if (item && typeof item === 'object' && 'url' in item && typeof item.url === 'string') {
          items.push({
            url: item.url,
            mimeType: (item as { mimeType?: string }).mimeType,
            role: (item as { role?: string }).role,
            volcAssetUri: (item as { volcAssetUri?: string }).volcAssetUri,
          });
        }
      }
    } else if (
      output.data &&
      typeof output.data === 'object' &&
      'url' in output.data &&
      typeof (output.data as { url: string }).url === 'string'
    ) {
      const d = output.data as { url: string; mimeType?: string; role?: string; volcAssetUri?: string };
      items.push({ url: d.url, mimeType: d.mimeType, role: d.role, volcAssetUri: d.volcAssetUri });
    }

    if (items.length === 1) {
      const item = items[0];
      files.push({
        role: (item.role as ResolvedVideoUploadFile['role']) ?? 'first',
        dataUrl: item.url,
        mimeType: item.mimeType,
        assetType: inferAssetType(item.mimeType),
        volcAssetUri: item.volcAssetUri,
      });
    } else if (items.length > 1) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        let role: ResolvedVideoUploadFile['role'];
        if (item.role) {
          role = item.role as ResolvedVideoUploadFile['role'];
        } else if (i === 0) {
          role = 'first';
        } else if (i === items.length - 1) {
          role = 'last';
        } else {
          role = 'reference';
        }
        files.push({
          role,
          dataUrl: item.url,
          mimeType: item.mimeType,
          assetType: inferAssetType(item.mimeType),
          volcAssetUri: item.volcAssetUri,
        });
      }
    }
  }

  // Append config-level refs (these have explicit roles)
  if (configRefMedia) {
    for (const ref of configRefMedia) {
      if (ref.url) {
        files.push({
          role: ref.role,
          dataUrl: ref.url,
          mimeType: ref.mimeType,
          assetType: ref.assetType,
          volcAssetUri: ref.volcAssetUri,
        });
      }
    }
  }

  return files;
}

function inferAssetType(
  mimeType?: string,
): 'image' | 'video' | 'audio' | undefined {
  if (!mimeType) return undefined;
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return undefined;
}

// ── 4. Missing upstream strategy ──────────────────────────────────────────

/**
 * Determine what to do when a required upstream output is missing.
 *
 * @param strategy - 'block': throw, 'skip': return null silently, 'use-config':
 *   return the node's own config value as fallback.
 * @returns The fallback value, or `null` if the strategy is 'skip'.
 * @throws Error if strategy is 'block'.
 */
export function resolveMissingUpstream<T>(
  nodeId: string,
  upstreamId: string,
  strategy: MissingUpstreamStrategy,
  configFallback?: T,
): T | null {
  if (strategy === 'block') {
    throw new Error(
      '上游节点 ' + upstreamId + ' 未产生输出，无法继续执行节点 ' + nodeId,
    );
  }
  if (strategy === 'use-config') {
    return configFallback ?? null;
  }
  // strategy === 'skip'
  return null;
}

// ── 5. Stale propagation ──────────────────────────────────────────────────

/**
 * Determine which downstream nodes should be marked `stale` when a node's
 * output is replaced (e.g., user re-runs a generator).
 *
 * Rules:
 *   - All transitive downstream nodes of the changed node are stale.
 *   - But: if a downstream node has multiple upstream inputs and only one
 *     changed, the downstream is still stale (conservative — we assume any
 *     change could affect the result).
 *
 * @returns Set of node IDs that should be marked stale.
 */
export function getStaleDownstreamNodes(
  sourceNodeId: string,
  nodes: BlueprintNode[],
  edges: BlueprintEdge[],
): Set<string> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target);
    }
  }

  const stale = new Set<string>();
  const queue = [sourceNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const downstream of adjacency.get(current) ?? []) {
      if (!stale.has(downstream)) {
        stale.add(downstream);
        queue.push(downstream);
      }
    }
  }
  return stale;
}
