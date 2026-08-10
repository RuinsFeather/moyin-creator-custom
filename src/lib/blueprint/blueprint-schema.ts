// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import {
  BLUEPRINT_NODE_PORTS,
  BLUEPRINT_SCHEMA_VERSION,
  type BlueprintDataType,
  type BlueprintNode,
  type BlueprintPortDefinition,
  type BlueprintNodeType,
  type BlueprintProject,
  type BlueprintSourceRef,
} from '@/types/blueprint';

export const BLUEPRINT_NODE_TYPES = [
  'text-input',
  'image-reference',
  'video-reference',
  'script-import',
  'image-generator',
  'video-generator',
  'output',
] as const satisfies readonly BlueprintNodeType[];

const blueprintNodeTypeSet = new Set<string>(BLUEPRINT_NODE_TYPES);

export function isBlueprintNodeType(value: unknown): value is BlueprintNodeType {
  return typeof value === 'string' && blueprintNodeTypeSet.has(value);
}

export function getBlueprintPort(
  nodeType: BlueprintNodeType,
  portId: string,
  direction: BlueprintPortDefinition['direction'],
): BlueprintPortDefinition | undefined {
  return BLUEPRINT_NODE_PORTS[nodeType].find(
    (port) => port.id === portId && port.direction === direction,
  );
}

export function canConnectBlueprintPorts(
  sourceNodeType: BlueprintNodeType,
  sourcePortId: string,
  targetNodeType: BlueprintNodeType,
  targetPortId: string,
  dataType: BlueprintDataType,
): boolean {
  const sourcePort = getBlueprintPort(sourceNodeType, sourcePortId, 'output');
  const targetPort = getBlueprintPort(targetNodeType, targetPortId, 'input');

  return Boolean(
    sourcePort?.dataTypes.includes(dataType) &&
      targetPort?.dataTypes.includes(dataType),
  );
}

/** Missing source versions are not guessed; only a known version change is stale. */
export function isBlueprintSourceStale(
  sourceRef: BlueprintSourceRef | undefined,
  currentSourceVersion: string | undefined,
): boolean {
  return Boolean(
    sourceRef?.sourceVersion &&
      currentSourceVersion &&
      sourceRef.sourceVersion !== currentSourceVersion,
  );
}

export function isBlueprintNodeSourceConsistent(node: BlueprintNode): boolean {
  const { sourceRef, sourceSnapshot } = node.data;
  if (!sourceSnapshot) return true;

  return Boolean(
    sourceRef &&
      sourceSnapshot.kind === sourceRef.kind &&
      sourceSnapshot.sourceId === sourceRef.id &&
      sourceSnapshot.sourceVersion === sourceRef.sourceVersion,
  );
}

export function isBlueprintProject(value: unknown): value is BlueprintProject {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<BlueprintProject>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.projectId === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(
      (node) =>
        isBlueprintNodeType(node?.data?.nodeType) &&
        isBlueprintNodeSourceConsistent(node),
    ) &&
    Array.isArray(candidate.edges) &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.updatedAt === 'number'
  );
}

export function createEmptyBlueprintProject(
  projectId: string,
  id: string,
  name = '未命名蓝图',
  now = Date.now(),
): BlueprintProject {
  return {
    id,
    projectId,
    name,
    version: BLUEPRINT_SCHEMA_VERSION,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}
