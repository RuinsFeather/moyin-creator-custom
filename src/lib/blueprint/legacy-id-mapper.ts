// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Legacy ID Mapping Utilities (§10.3)
 *
 * Handles the type mismatch between legacy Director `SplitScene.id` (number)
 * and blueprint's `BlueprintSourceRef.id` (string), as well as `Shot.id` (string).
 *
 * ── Type Mapping Contract ──────────────────────────────────────
 * - `Shot.id` is `string` — maps 1:1 to `BlueprintSourceRef.id`.
 * - `SplitScene.id` is `number` — must be converted via `splitSceneIdToString()`.
 * - All `BlueprintSourceRef.id` values are `string` (the canonical format).
 *
 * ── Source Kind Strategy ───────────────────────────────────────
 * - New imports: use `'shot'` (from script) or `'media'` (direct media ref).
 * - Legacy reads: use `'director-scene'` only when reading old Director data.
 * - `'director-scene'` must NOT be used for new blueprint creation.
 * ───────────────────────────────────────────────────────────────
 */

import type { BlueprintSourceRef } from '@/types/blueprint';

/**
 * Convert a Director `SplitScene.id` (number) to a string suitable for
 * `BlueprintSourceRef.id`.
 *
 * Uses `String()` for consistent conversion (not template literal).
 * The result is a plain decimal string with no prefix.
 */
export function splitSceneIdToString(id: number): string {
  return String(id);
}

/**
 * Parse a `BlueprintSourceRef.id` back to a Director `SplitScene.id` (number).
 *
 * Returns `NaN` if the string is not a valid number (e.g., a UUID-based Shot.id).
 * Use `isDirectorSceneSourceRef()` to check kind before parsing.
 */
export function sourceRefToSplitSceneId(ref: BlueprintSourceRef): number {
  if (ref.kind !== 'director-scene') {
    return NaN;
  }
  return Number(ref.id);
}

/**
 * Create a `director-scene` sourceRef for reading legacy Director data.
 *
 * **WARNING**: This creates a backward-compatibility sourceRef.
 * For new imports, prefer `shot` or `media` kinds via `script-to-blueprint.ts`.
 *
 * @param sceneId - The Director SplitScene numeric ID.
 * @param sourceVersion - Optional version string (e.g., timestamp of Director save).
 */
export function makeLegacyDirectorSourceRef(
  sceneId: number,
  sourceVersion?: string,
): BlueprintSourceRef {
  return {
    kind: 'director-scene',
    id: splitSceneIdToString(sceneId),
    sourceVersion,
  };
}

/**
 * Check if a sourceRef points to a legacy Director scene.
 * Useful for determining whether to show legacy-specific error handling.
 */
export function isDirectorSceneSourceRef(
  ref: BlueprintSourceRef | undefined,
): ref is BlueprintSourceRef & { kind: 'director-scene' } {
  return ref?.kind === 'director-scene';
}

/**
 * Check if a sourceRef uses the legacy `director-scene` kind.
 * When this returns `true`, the node should be treated as read-only
 * and may show a "source migrated" warning in the UI.
 */
export function isLegacySourceRef(ref: BlueprintSourceRef | undefined): boolean {
  return ref?.kind === 'director-scene';
}

/**
 * Convert a legacy `director-scene` sourceRef to the preferred `shot` kind.
 *
 * Returns `null` if the input is not a `director-scene` ref.
 * The returned ref has no `sourceVersion` (caller should provide one
 * if the shot version is known).
 */
export function migrateDirectorSourceRefToShot(
  ref: BlueprintSourceRef,
  shotId?: string,
): BlueprintSourceRef | null {
  if (ref.kind !== 'director-scene') {
    return null;
  }
  // If a shot ID mapping is available, use it; otherwise preserve the numeric ID
  return {
    kind: 'shot',
    id: shotId ?? ref.id,
  };
}
