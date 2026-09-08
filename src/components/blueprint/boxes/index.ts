// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Node type registry for the canvas. §4.1 / P1-7.
//
// Replaces the old 7-node-component registry (`nodes/index.ts`) with the
// 3 box components (TextBox/ImageBox/VideoBox) plus the retained
// script-import/output nodes. Legacy v1 type strings are kept mapped to
// their v2 equivalents for backward compatibility with any not-yet-migrated
// data (the store migration should normally handle this before render).

import type { NodeTypes } from '@xyflow/react';
import { TextBox } from './TextBox';
import { ImageBox } from './ImageBox';
import { VideoBox } from './VideoBox';
import { ScriptImportNode } from '../nodes/ScriptImportNode';

/**
 * Stable NodeTypes mapping passed to <ReactFlow>.
 * Keys must match BlueprintNodeType values exactly.
 */
export const blueprintNodeTypes: NodeTypes = {
  'text-box': TextBox,
  'image-box': ImageBox,
  'video-box': VideoBox,
  'script-import': ScriptImportNode,
  // Legacy types retained for migration compatibility
  'text-input': TextBox,
  'image-reference': ImageBox,
  'video-reference': VideoBox,
  'image-generator': ImageBox,
  'video-generator': VideoBox,
};

export { TextBox, ImageBox, VideoBox, ScriptImportNode };
