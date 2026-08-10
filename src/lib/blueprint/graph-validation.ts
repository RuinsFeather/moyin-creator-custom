// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import {
  BLUEPRINT_NODE_PORTS,
  type BlueprintNode,
  type BlueprintEdge,
  type BlueprintProject,
  type BlueprintPortDefinition,
  type BlueprintImageGeneratorConfig,
  type BlueprintVideoGeneratorConfig,
} from '@/types/blueprint';
import { isBlueprintNodeType } from './blueprint-schema';

// ── Diagnostic contract ───────────────────────────────────────────────────

export type BlueprintDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface BlueprintDiagnostic {
  code: string;
  severity: BlueprintDiagnosticSeverity;
  nodeId?: string;
  edgeId?: string;
  message: string;
}

export const BLUEPRINT_DIAGNOSTIC_CODES = {
  duplicateNodeId: 'duplicate-node-id',
  invalidNodeType: 'invalid-node-type',
  missingEdgeSource: 'missing-edge-source',
  missingEdgeTarget: 'missing-edge-target',
  selfLoop: 'self-loop',
  duplicateEdge: 'duplicate-edge',
  cycle: 'cycle',
  invalidPort: 'invalid-port',
  incompatibleDataType: 'incompatible-data-type',
  missingRequiredInput: 'missing-required-input',
  generatorMissingPrompt: 'generator-missing-prompt',
  generatorMissingModel: 'generator-missing-model',
  projectMissingId: 'project-missing-id',
  outputNoUpstream: 'output-no-upstream',
  directorSceneLegacyNode: 'director-scene-legacy-node',
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Returns the input port definitions for a node type. */
function getInputPorts(
  nodeType: string,
): readonly BlueprintPortDefinition[] {
  const ports = BLUEPRINT_NODE_PORTS[nodeType as keyof typeof BLUEPRINT_NODE_PORTS];
  if (!ports) return [];
  return (ports as readonly BlueprintPortDefinition[]).filter(
    (p) => p.direction === 'input',
  );
}

/** Check whether a generator node has an inline prompt configured. */
function hasInlinePrompt(node: BlueprintNode): boolean {
  const { nodeType, config } = node.data;
  if (nodeType === 'image-generator') {
    const c = config as BlueprintImageGeneratorConfig;
    return typeof c.prompt === 'string' && c.prompt.trim().length > 0;
  }
  if (nodeType === 'video-generator') {
    const c = config as BlueprintVideoGeneratorConfig;
    return typeof c.prompt === 'string' && c.prompt.trim().length > 0;
  }
  return false;
}

/**
 * Check whether a node has at least one upstream edge connected to a
 * prompt-type input (accepts 'text' or 'context' data types).
 */
function hasUpstreamTextInput(
  nodeId: string,
  edges: BlueprintEdge[],
  nodes: Map<string, BlueprintNode>,
): boolean {
  return edges.some((edge) => {
    if (edge.target !== nodeId) return false;
    const sourceNode = nodes.get(edge.source);
    if (!sourceNode) return false;
    const ports = BLUEPRINT_NODE_PORTS[sourceNode.data.nodeType];
    if (!ports) return false;
    const port = (ports as readonly BlueprintPortDefinition[]).find(
      (p) => p.id === edge.sourceHandle && p.direction === 'output',
    );
    return Boolean(
      port?.dataTypes.some((dt) => dt === 'text' || dt === 'context'),
    );
  });
}

// ── Main validator ────────────────────────────────────────────────────────

export interface ValidateBlueprintOptions {
  /** The blueprint project to validate. */
  project: BlueprintProject;
  /**
   * Optional map of generator node IDs to the set of upstream text/context
   * edges that supply their prompt. When omitted the validator builds this
   * from the edge list.
   */
  promptEdgeMap?: Map<string, Set<string>>;
}

/**
 * Validate a blueprint graph against all structural rules.
 *
 * Returns an array of diagnostics. An empty array means the graph is valid.
 * Errors indicate blocking problems; warnings are advisory.
 */
export function validateBlueprintGraph(
  options: ValidateBlueprintOptions,
): BlueprintDiagnostic[] {
  const { project } = options;
  const { nodes, edges } = project;
  const diagnostics: BlueprintDiagnostic[] = [];

  const codes = BLUEPRINT_DIAGNOSTIC_CODES;

  // ── Build lookups ─────────────────────────────────────────────────

  const nodeMap = new Map<string, BlueprintNode>();
  const nodeIdCounts = new Map<string, number>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);

    // 1. Duplicate node IDs
    const count = (nodeIdCounts.get(node.id) ?? 0) + 1;
    nodeIdCounts.set(node.id, count);
    if (count > 1) {
      diagnostics.push({
        code: codes.duplicateNodeId,
        severity: 'error',
        nodeId: node.id,
        message: `节点 ID 重复: "${node.id}"`,
      });
    }

    // 2. Valid node type
    if (!isBlueprintNodeType(node.data.nodeType)) {
      diagnostics.push({
        code: codes.invalidNodeType,
        severity: 'error',
        nodeId: node.id,
        message: `节点类型无效: "${node.data.nodeType}"`,
      });
    }
  }

  const edgeSignatureSet = new Set<string>();
  const incomingEdgeCount = new Map<string, Map<string, number>>();

  for (const edge of edges) {
    // 3. Source/target exist
    if (!nodeMap.has(edge.source)) {
      diagnostics.push({
        code: codes.missingEdgeSource,
        severity: 'error',
        edgeId: edge.id,
        message: `边的源节点不存在: "${edge.source}"`,
      });
      continue;
    }
    if (!nodeMap.has(edge.target)) {
      diagnostics.push({
        code: codes.missingEdgeTarget,
        severity: 'error',
        edgeId: edge.id,
        message: `边的目标节点不存在: "${edge.target}"`,
      });
      continue;
    }

    // 4. Self-loop
    if (edge.source === edge.target) {
      diagnostics.push({
        code: codes.selfLoop,
        severity: 'error',
        edgeId: edge.id,
        nodeId: edge.source,
        message: `不允许自环边: 节点 "${edge.source}"`,
      });
      continue;
    }

    // 5. Duplicate edges (same source+handle → target+handle)
    const sourceHandle = edge.sourceHandle ?? '';
    const targetHandle = edge.targetHandle ?? '';
    const signature = `${edge.source}:${sourceHandle}→${edge.target}:${targetHandle}`;
    if (edgeSignatureSet.has(signature)) {
      diagnostics.push({
        code: codes.duplicateEdge,
        severity: 'warning',
        edgeId: edge.id,
        message: `重复边: ${edge.source}→${edge.target}`,
      });
    }
    edgeSignatureSet.add(signature);

    const sourceNode = nodeMap.get(edge.source)!;
    const targetNode = nodeMap.get(edge.target)!;
    const sourceNodeType = sourceNode.data.nodeType;
    const targetNodeType = targetNode.data.nodeType;

    // 6. Handle belongs to declared port
    const sourcePortDefs = BLUEPRINT_NODE_PORTS[sourceNodeType] as
      | readonly BlueprintPortDefinition[]
      | undefined;
    const targetPortDefs = BLUEPRINT_NODE_PORTS[targetNodeType] as
      | readonly BlueprintPortDefinition[]
      | undefined;

    const sourcePort = sourcePortDefs?.find(
      (p) => p.id === sourceHandle && p.direction === 'output',
    );
    if (sourceHandle && !sourcePort) {
      diagnostics.push({
        code: codes.invalidPort,
        severity: 'error',
        edgeId: edge.id,
        nodeId: edge.source,
        message: `源端口 "${sourceHandle}" 不属于节点类型 "${sourceNodeType}"`,
      });
      continue;
    }

    const targetPort = targetPortDefs?.find(
      (p) => p.id === targetHandle && p.direction === 'input',
    );
    if (targetHandle && !targetPort) {
      diagnostics.push({
        code: codes.invalidPort,
        severity: 'error',
        edgeId: edge.id,
        nodeId: edge.target,
        message: `目标端口 "${targetHandle}" 不属于节点类型 "${targetNodeType}"`,
      });
      continue;
    }

    // 7. Data type compatibility
    const edgeDataType = edge.data?.dataType;
    if (edgeDataType && sourcePort && targetPort) {
      const sourceCompatible = sourcePort.dataTypes.includes(edgeDataType);
      const targetCompatible = targetPort.dataTypes.includes(edgeDataType);
      if (!sourceCompatible || !targetCompatible) {
        diagnostics.push({
          code: codes.incompatibleDataType,
          severity: 'error',
          edgeId: edge.id,
          message: `数据类型不兼容: 源端口 [${sourcePort.dataTypes.join(', ')}] ↔ 目标端口 [${targetPort.dataTypes.join(', ')}] (边类型: ${edgeDataType})`,
        });
        continue;
      }
    }

    // Track incoming edges per target port for required-input check
    if (targetHandle) {
      let portMap = incomingEdgeCount.get(edge.target);
      if (!portMap) {
        portMap = new Map();
        incomingEdgeCount.set(edge.target, portMap);
      }
      portMap.set(targetHandle, (portMap.get(targetHandle) ?? 0) + 1);
    }
  }

  // ── Cycle detection (DFS-based) ──────────────────────────────────

  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (
      nodeMap.has(edge.source) &&
      nodeMap.has(edge.target) &&
      edge.source !== edge.target // exclude self-loops
    ) {
      adjacency.get(edge.source)!.push(edge.target);
    }
  }

  const WHITE = 0; // unvisited
  const GRAY = 1;  // in current DFS path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  for (const node of nodes) color.set(node.id, WHITE);

  const cycleNodes = new Set<string>();

  function dfs(u: string): void {
    color.set(u, GRAY);
    for (const v of adjacency.get(u) ?? []) {
      const vColor = color.get(v);
      if (vColor === GRAY) {
        // Cycle detected — mark the cycle member
        cycleNodes.add(v);
        cycleNodes.add(u);
      } else if (vColor === WHITE) {
        dfs(v);
      }
    }
    color.set(u, BLACK);
  }

  for (const node of nodes) {
    if (color.get(node.id) === WHITE) dfs(node.id);
  }

  if (cycleNodes.size > 0) {
    diagnostics.push({
      code: codes.cycle,
      severity: 'error',
      message: `图中存在循环依赖，涉及 ${cycleNodes.size} 个节点`,
    });
  }

  // ── Required input check ─────────────────────────────────────────

  for (const node of nodes) {
    if (cycleNodes.has(node.id)) continue;

    const inputPorts = getInputPorts(node.data.nodeType);
    const nodeIncoming = incomingEdgeCount.get(node.id) ?? new Map<string, number>();

    for (const port of inputPorts) {
      if (port.required) {
        const count = nodeIncoming.get(port.id) ?? 0;
        if (count === 0) {
          diagnostics.push({
            code: codes.missingRequiredInput,
            severity: 'error',
            nodeId: node.id,
            message: `必填输入端口 "${port.id}" 未连接`,
          });
        }
      }
    }
  }

  // ── Project ID check ─────────────────────────────────────────────

  if (!project.projectId || project.projectId.trim().length === 0) {
    diagnostics.push({
      code: codes.projectMissingId,
      severity: 'error',
      message: '蓝图项目缺少 projectId，无法执行生成任务',
    });
  }

  // ── Generator node prompt check ──────────────────────────────────

  const generatorNodeTypes = new Set(['image-generator', 'video-generator']);

  for (const node of nodes) {
    if (cycleNodes.has(node.id)) continue;
    if (!generatorNodeTypes.has(node.data.nodeType)) continue;

    // Prompt check
    if (!hasInlinePrompt(node) && !hasUpstreamTextInput(node.id, edges, nodeMap)) {
      diagnostics.push({
        code: codes.generatorMissingPrompt,
        severity: 'warning',
        nodeId: node.id,
        message: `生成节点缺少提示词：请在配置中填写 prompt 或连接上游文本输入`,
      });
    }

    // Model check — generator needs a model to route to the correct provider
    const config = node.data.config as Record<string, unknown>;
    if (!config.model || typeof config.model !== 'string' || config.model.trim().length === 0) {
      diagnostics.push({
        code: codes.generatorMissingModel,
        severity: 'warning',
        nodeId: node.id,
        message: `生成节点未指定模型（model），执行时将使用默认模型`,
      });
    }
  }

  // ── Output node upstream check ───────────────────────────────────

  for (const node of nodes) {
    if (node.data.nodeType !== 'output') continue;

    const hasUpstream = edges.some((e) => e.target === node.id && nodeMap.has(e.source));
    if (!hasUpstream) {
      diagnostics.push({
        code: codes.outputNoUpstream,
        severity: 'warning',
        nodeId: node.id,
        message: '输出节点没有可执行的上游连接',
      });
    }
  }

  return diagnostics;
}

// ── Convenience wrappers ──────────────────────────────────────────────────

/** Returns true when the graph has zero error-severity diagnostics. */
export function isBlueprintGraphValid(
  project: BlueprintProject,
): boolean {
  const diagnostics = validateBlueprintGraph({ project });
  return !diagnostics.some((d) => d.severity === 'error');
}

/** Return only error-severity diagnostics. */
export function getBlueprintErrors(
  project: BlueprintProject,
): BlueprintDiagnostic[] {
  return validateBlueprintGraph({ project }).filter(
    (d) => d.severity === 'error',
  );
}

/** Return only warning-severity diagnostics. */
export function getBlueprintWarnings(
  project: BlueprintProject,
): BlueprintDiagnostic[] {
  return validateBlueprintGraph({ project }).filter(
    (d) => d.severity === 'warning',
  );
}

// ── Legacy Director sourceRef validation (§10.3) ─────────────────────────

/**
 * Validate nodes that reference legacy Director scenes.
 *
 * Nodes with `sourceRef.kind === 'director-scene'` are legacy-originated.
 * They should show a warning diagnostic so the UI can display a
 * "source migrated" badge and prompt the user to review the node.
 *
 * This is separate from the main structural validator because it
 * addresses data provenance rather than graph structure.
 *
 * @param project - The blueprint project to scan.
 * @returns Diagnostics for all nodes with legacy Director sourceRefs.
 */
export function validateLegacyDirectorSourceRefs(
  project: BlueprintProject,
): BlueprintDiagnostic[] {
  const diagnostics: BlueprintDiagnostic[] = [];
  const codes = BLUEPRINT_DIAGNOSTIC_CODES;

  for (const node of project.nodes) {
    const sourceRef = node.data.sourceRef;
    if (sourceRef?.kind === 'director-scene') {
      diagnostics.push({
        code: codes.directorSceneLegacyNode,
        severity: 'warning',
        nodeId: node.id,
        message: `节点 "${node.data.label}" 引用了旧版 Director 数据 (scene ID: ${sourceRef.id})。该节点为快照副本，不会自动同步 Director 的修改。建议检查节点配置后保存。`,
      });
    }
  }

  return diagnostics;
}
