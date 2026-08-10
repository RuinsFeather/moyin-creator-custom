// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Director → Blueprint conversion (§10.3)
 *
 * Converts legacy Director `SplitScene` data into blueprint node groups.
 * This is a **read-only compatibility adapter** — it reads Director data
 * and creates blueprint nodes, but does NOT route Director's generation
 * pipeline through Freedom API.
 *
 * ── Generation Chain Boundary ──────────────────────────────────
 * This module ONLY reads SplitScene data fields. It does NOT import
 * Director store actions, Director generation hooks, or Director's
 * parameter/state chain. All generated blueprint nodes use Freedom
 * API-compatible executors (image-generator / video-generator).
 *
 * ── Source Reference Strategy ──────────────────────────────────
 * Nodes created by this adapter use `kind: 'director-scene'` in
 * their sourceRef to mark them as legacy-originated. This signals
 * to the UI that these nodes are read-only snapshots of old Director
 * data and may show migration warnings.
 *
 * For new imports, use `script-to-blueprint.ts` which produces
 * `kind: 'shot'` sourceRefs.
 * ───────────────────────────────────────────────────────────────
 */

import type {
  BlueprintNode,
  BlueprintEdge,
  BlueprintProject,
  BlueprintSourceRef,
  BlueprintImageGeneratorConfig,
  TextInputNodeConfig,
  ScriptImportNodeConfig,
  OutputNodeConfig,
} from '@/types/blueprint';
import { BLUEPRINT_SCHEMA_VERSION } from '@/types/blueprint';
import { generateUUID } from '@/lib/utils';
import type { BlueprintDiagnostic } from './graph-validation';
import { splitSceneIdToString, makeLegacyDirectorSourceRef } from './legacy-id-mapper';

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Minimal interface matching Director `SplitScene` fields needed for
 * blueprint conversion. This avoids importing the full Director store
 * type and keeps the dependency boundary clean.
 *
 * The field names and types mirror `SplitScene` in director-store.ts.
 */
export interface DirectorSceneData {
  id: number;
  sceneName: string;
  sceneLocation: string;
  imagePrompt: string;
  imagePromptZh: string;
  videoPrompt: string;
  videoPromptZh: string;
  dialogue: string;
  actionSummary: string;
  shotSize: string | null;
  duration: string;
  characterIds: string[];
  emotionTags?: string[];
  // Optional metadata for traceability
  sceneLibraryId?: string;
  viewpointId?: string;
}

export interface ConvertDirectorToBlueprintOptions {
  /** Target project ID for the blueprint. */
  projectId: string;
  /** Director split scenes to convert. */
  scenes: DirectorSceneData[];
  /** Which scene IDs (number) to include. When omitted, all scenes are converted. */
  selectedSceneIds?: number[];
  /** Optional blueprint name override. */
  name?: string;
  /** Existing blueprint ID to update (for re-import). */
  existingBlueprintId?: string;
  /** Source version for traceability (e.g., Director save timestamp). */
  sourceVersion?: string;
}

export interface DirectorToBlueprintResult {
  /** The generated blueprint project. */
  blueprint: BlueprintProject;
  /** Number of scenes converted. */
  sceneCount: number;
  /** Number of nodes created. */
  nodeCount: number;
  /** Number of edges created. */
  edgeCount: number;
  /** Scene IDs (number) that were included. */
  includedSceneIds: number[];
  /**
   * Diagnostics generated during conversion.
   * Includes warnings for scenes without prompts, missing data,
   * and legacy source references.
   */
  diagnostics: BlueprintDiagnostic[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Pick the best available prompt from a Director scene.
 *
 * Director scenes have both English and Chinese prompts.
 * Prefer Chinese (user-facing) for the text-input node,
 * fall back to English, then to actionSummary / dialogue.
 */
function resolveScenePrompt(scene: DirectorSceneData): string {
  return scene.imagePromptZh
    || scene.imagePrompt
    || scene.videoPromptZh
    || scene.videoPrompt
    || scene.actionSummary
    || scene.dialogue
    || '';
}

/**
 * Build a director-scene sourceRef for a legacy Director scene.
 */
function makeDirectorSourceRef(
  scene: DirectorSceneData,
  sourceVersion?: string,
): BlueprintSourceRef {
  return makeLegacyDirectorSourceRef(scene.id, sourceVersion);
}

/**
 * Generate diagnostics for the given scenes.
 */
function generateDirectorConversionDiagnostics(
  scenes: DirectorSceneData[],
  includedSceneIds: number[],
): BlueprintDiagnostic[] {
  const diagnostics: BlueprintDiagnostic[] = [];

  for (const sceneId of includedSceneIds) {
    const scene = scenes.find((s) => s.id === sceneId);
    if (!scene) continue;

    const prompt = resolveScenePrompt(scene);
    if (!prompt) {
      diagnostics.push({
        code: 'director-scene-missing-prompt',
        severity: 'warning',
        message: `分镜 "${scene.sceneName}" (ID: ${scene.id}) 没有可用的提示词。仅生成 script-import 节点，不创建生成器。`,
      });
    }

    if (!scene.sceneName) {
      diagnostics.push({
        code: 'director-scene-missing-name',
        severity: 'info',
        message: `分镜 ID ${scene.id} 缺少场景名称，使用默认标签。`,
      });
    }

    // Add a general info diagnostic about legacy origin
    diagnostics.push({
      code: 'director-scene-legacy-origin',
      severity: 'info',
      message: `分镜 "${scene.sceneName || scene.id}" (ID: ${scene.id}) 来源于旧版 Director 数据，sourceRef 类型为 'director-scene'。建议导入后检查并更新节点配置。`,
    });
  }

  return diagnostics;
}

// ── Main conversion ───────────────────────────────────────────────────────

/**
 * Convert Director split scenes into a blueprint graph.
 *
 * Each scene generates a node group (same pattern as script-to-blueprint):
 * 1. `text-input` — the scene's image prompt
 * 2. `script-import` — context reference linking back to the Director scene
 * 3. `image-generator` — connects to text-input + script-import
 * 4. `output` — collects the generated image
 *
 * When a scene has no usable prompt, only a script-import node is created.
 *
 * **IMPORTANT**: This adapter creates blueprint nodes that use Freedom API
 * executors. Director's own generation pipeline (parameter/state chain) is
 * NOT invoked. The resulting blueprint is a snapshot of Director data,
 * not a live link to Director's generation system.
 */
export function convertDirectorToBlueprint(
  options: ConvertDirectorToBlueprintOptions,
): DirectorToBlueprintResult {
  const {
    projectId,
    selectedSceneIds,
    name,
    existingBlueprintId,
    sourceVersion,
  } = options;

  const scenes = options.scenes;

  // Filter scenes
  const targetScenes = selectedSceneIds && selectedSceneIds.length > 0
    ? scenes.filter((s) => selectedSceneIds.includes(s.id))
    : scenes;

  const nodes: BlueprintNode[] = [];
  const edges: BlueprintEdge[] = [];
  const includedSceneIds: number[] = [];

  // Track positions for auto-layout
  let yOffset = 0;
  const X_SPACING = 320;
  const Y_SPACING = 200;

  for (const scene of targetScenes) {
    const prompt = resolveScenePrompt(scene);
    const sourceRef = makeDirectorSourceRef(scene, sourceVersion);
    const sceneLabel = scene.sceneName || `分镜 ${scene.id}`;

    // 1. Text-input node for the prompt
    const textInputId = generateUUID();
    const textConfig: TextInputNodeConfig = { text: prompt };
    nodes.push({
      id: textInputId,
      type: 'text-input',
      position: { x: 0, y: yOffset },
      data: {
        nodeType: 'text-input',
        label: `${sceneLabel} 提示词`,
        config: textConfig,
        sourceRef,
      },
    });

    // 2. Script-import node for context (uses scene ID as string)
    const scriptImportId = generateUUID();
    const importConfig: ScriptImportNodeConfig = {
      selectedShotIds: [splitSceneIdToString(scene.id)],
      mode: 'snapshot',
    };
    nodes.push({
      id: scriptImportId,
      type: 'script-import',
      position: { x: 0, y: yOffset + Y_SPACING * 0.5 },
      data: {
        nodeType: 'script-import',
        label: `${sceneLabel} 上下文`,
        config: importConfig,
        sourceRef,
      },
    });

    if (prompt) {
      // 3. Image-generator node
      const generatorId = generateUUID();
      const genConfig: BlueprintImageGeneratorConfig = {
        prompt: '',
      };
      nodes.push({
        id: generatorId,
        type: 'image-generator',
        position: { x: X_SPACING, y: yOffset },
        data: {
          nodeType: 'image-generator',
          label: `${sceneLabel} 生成`,
          config: genConfig,
          sourceRef,
        },
      });

      // 4. Output node
      const outputId = generateUUID();
      const outConfig: OutputNodeConfig = {
        acceptedTypes: ['image'],
      };
      nodes.push({
        id: outputId,
        type: 'output',
        position: { x: X_SPACING * 2, y: yOffset },
        data: {
          nodeType: 'output',
          label: `${sceneLabel} 输出`,
          config: outConfig,
          sourceRef,
        },
      });

      // Edges: text-input → image-generator (prompt port)
      edges.push({
        id: generateUUID(),
        source: textInputId,
        target: generatorId,
        sourceHandle: 'text',
        targetHandle: 'prompt',
        type: 'blueprint',
        data: { dataType: 'text' },
      });

      // Edges: script-import → image-generator (prompt port, for context)
      edges.push({
        id: generateUUID(),
        source: scriptImportId,
        target: generatorId,
        sourceHandle: 'context',
        targetHandle: 'prompt',
        type: 'blueprint',
        data: { dataType: 'context' },
      });

      // Edges: image-generator → output
      edges.push({
        id: generateUUID(),
        source: generatorId,
        target: outputId,
        sourceHandle: 'image',
        targetHandle: 'media',
        type: 'blueprint',
        data: { dataType: 'image' },
      });
    }

    includedSceneIds.push(scene.id);
    yOffset += Y_SPACING;
  }

  const blueprintId = existingBlueprintId ?? generateUUID();
  const blueprintName = name ?? `Director 导入 ${new Date().toLocaleDateString('zh-CN')}`;

  const blueprint: BlueprintProject = {
    id: blueprintId,
    projectId,
    name: blueprintName,
    version: BLUEPRINT_SCHEMA_VERSION,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Generate diagnostics
  const diagnostics = generateDirectorConversionDiagnostics(scenes, includedSceneIds);

  return {
    blueprint,
    sceneCount: includedSceneIds.length,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    includedSceneIds,
    diagnostics,
  };
}

/**
 * Create a lightweight preview of what the blueprint would look like
 * when converting Director scenes.
 *
 * Returns summary info without the full node graph (useful for UI diff).
 */
export function previewDirectorToBlueprint(
  options: Omit<ConvertDirectorToBlueprintOptions, 'existingBlueprintId'>,
): {
  sceneCount: number;
  nodeCount: number;
  hasPrompts: number;
  missingPrompts: number;
  diagnostics: BlueprintDiagnostic[];
} {
  const scenes = options.scenes;
  const targetScenes = options.selectedSceneIds && options.selectedSceneIds.length > 0
    ? scenes.filter((s) => options.selectedSceneIds!.includes(s.id))
    : scenes;

  let hasPrompts = 0;
  let missingPrompts = 0;

  for (const scene of targetScenes) {
    const prompt = resolveScenePrompt(scene);
    if (prompt) {
      hasPrompts++;
    } else {
      missingPrompts++;
    }
  }

  // Each scene with prompt: 4 nodes (text-input + script-import + image-generator + output)
  // Each scene without prompt: 2 nodes (text-input + script-import)
  const nodeCount = hasPrompts * 4 + missingPrompts * 2;
  const diagnostics = generateDirectorConversionDiagnostics(
    scenes,
    targetScenes.map((s) => s.id),
  );

  return {
    sceneCount: targetScenes.length,
    nodeCount,
    hasPrompts,
    missingPrompts,
    diagnostics,
  };
}
