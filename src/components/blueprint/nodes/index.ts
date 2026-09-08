// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { NodeTypes } from '@xyflow/react';
import { TextInputNode } from './TextInputNode';
import { ImageReferenceNode } from './ImageReferenceNode';
import { VideoReferenceNode } from './VideoReferenceNode';
import { ScriptImportNode } from './ScriptImportNode';
import { ImageGeneratorNode } from './ImageGeneratorNode';
import { VideoGeneratorNode } from './VideoGeneratorNode';
import { OutputNode } from './OutputNode';

/**
 * Stable NodeTypes mapping passed to <ReactFlow>.
 * Keys must match BlueprintNodeType values exactly.
 */
export const blueprintNodeTypes: NodeTypes = {
  // v2 box types (use existing components until P1/P2 UI refactor)
  'text-box': TextInputNode,
  'image-box': ImageGeneratorNode,
  'video-box': VideoGeneratorNode,
  'script-import': ScriptImportNode,
  output: OutputNode,
  // Legacy types retained for migration compatibility
  'text-input': TextInputNode,
  'image-reference': ImageReferenceNode,
  'video-reference': VideoReferenceNode,
  'image-generator': ImageGeneratorNode,
  'video-generator': VideoGeneratorNode,
};

export {
  TextInputNode,
  ImageReferenceNode,
  VideoReferenceNode,
  ScriptImportNode,
  ImageGeneratorNode,
  VideoGeneratorNode,
  OutputNode,
};
