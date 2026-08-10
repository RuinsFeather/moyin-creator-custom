// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Legacy Library Mapper (§10.3)
 *
 * Maps old Character Library and Scene Library data into script/storyboard
 * context or internal media metadata, preserving traceable IDs.
 *
 * ── Design Principle ───────────────────────────────────────────
 * Character Library and Scene Library are internal data stores.
 * They are NOT exposed as first-class navigation destinations
 * (the old "assets" tab has been removed).
 *
 * Script-level characters (`ScriptCharacter`) and scenes (`ScriptScene`)
 * reference library items via `characterLibraryId` / `sceneLibraryId`.
 * This module resolves those references into usable context for
 * blueprint nodes, AI prompts, and media generation.
 *
 * The library IDs are preserved in the output for traceability —
 * consumers can track where data originated even after migration.
 * ───────────────────────────────────────────────────────────────
 */

/**
 * Minimal character data from the Character Library.
 * Mirrors the essential fields of `Character` in character-library-store.ts
 * without importing the store directly.
 */
export interface LibraryCharacterSnapshot {
  id: string;
  name: string;
  description: string;
  visualTraits: string;
  gender?: string;
  age?: string;
  personality?: string;
  role?: string;
  traits?: string;
  appearance?: string;
  tags?: string[];
  notes?: string;
  /** Main preview image URL (base look). */
  thumbnailUrl?: string;
  /** English visual prompt for AI image generation. */
  visualPromptEn?: string;
  /** Chinese visual prompt. */
  visualPromptZh?: string;
}

/**
 * Minimal scene data from the Scene Library.
 * Mirrors the essential fields of `Scene` in scene-store.ts
 * without importing the store directly.
 */
export interface LibrarySceneSnapshot {
  id: string;
  name: string;
  location: string;
  time: string;
  atmosphere: string;
  visualPrompt?: string;
  referenceImage?: string;
  tags?: string[];
  notes?: string;
  architectureStyle?: string;
  colorPalette?: string;
  lightingDesign?: string;
  keyProps?: string[];
}

/**
 * Resolved context for a script character, enriched with library data.
 * This is the "mapped" output that can be used by blueprint nodes or AI prompts.
 */
export interface ResolvedCharacterContext {
  /** Script-level character ID. */
  scriptCharacterId: string;
  /** Library character ID (preserved for traceability). */
  libraryCharacterId: string | null;
  /** Character name. */
  name: string;
  /** Combined description for AI prompt context. */
  promptDescription: string;
  /** Visual traits for image generation consistency. */
  visualTraits: string;
  /** Reference image URL from the library (if available). */
  referenceImageUrl: string | null;
  /** Character tags for filtering. */
  tags: string[];
}

/**
 * Resolved context for a script scene, enriched with library data.
 */
export interface ResolvedSceneContext {
  /** Script-level scene ID. */
  scriptSceneId: string;
  /** Library scene ID (preserved for traceability). */
  librarySceneId: string | null;
  /** Scene name. */
  name: string;
  /** Combined visual prompt for AI context. */
  promptDescription: string;
  /** Location description. */
  location: string;
  /** Time of day. */
  time: string;
  /** Atmosphere description. */
  atmosphere: string;
  /** Reference image URL from the library (if available). */
  referenceImageUrl: string | null;
  /** Scene tags for filtering. */
  tags: string[];
}

// ── Mapping functions ─────────────────────────────────────────────────────

/**
 * Build a prompt description string from a library character's attributes.
 *
 * Combines name, role, personality, appearance, and visual traits into
 * a single text block suitable for AI image/video generation prompts.
 */
export function buildCharacterPromptDescription(
  char: LibraryCharacterSnapshot,
): string {
  const parts: string[] = [];

  if (char.name) parts.push(`角色名: ${char.name}`);
  if (char.role) parts.push(`身份: ${char.role}`);
  if (char.gender) parts.push(`性别: ${char.gender}`);
  if (char.age) parts.push(`年龄: ${char.age}`);
  if (char.personality) parts.push(`性格: ${char.personality}`);
  if (char.traits) parts.push(`特质: ${char.traits}`);
  if (char.appearance) parts.push(`外貌: ${char.appearance}`);
  if (char.visualTraits) parts.push(`视觉特征: ${char.visualTraits}`);
  if (char.description) parts.push(`描述: ${char.description}`);

  return parts.join('；');
}

/**
 * Build a prompt description string from a library scene's attributes.
 */
export function buildScenePromptDescription(
  scene: LibrarySceneSnapshot,
): string {
  const parts: string[] = [];

  if (scene.name) parts.push(`场景: ${scene.name}`);
  if (scene.location) parts.push(`地点: ${scene.location}`);
  if (scene.time) parts.push(`时间: ${scene.time}`);
  if (scene.atmosphere) parts.push(`氛围: ${scene.atmosphere}`);
  if (scene.visualPrompt) parts.push(`视觉描述: ${scene.visualPrompt}`);
  if (scene.architectureStyle) parts.push(`建筑风格: ${scene.architectureStyle}`);
  if (scene.colorPalette) parts.push(`色彩基调: ${scene.colorPalette}`);
  if (scene.lightingDesign) parts.push(`光影: ${scene.lightingDesign}`);
  if (scene.keyProps && scene.keyProps.length > 0) {
    parts.push(`关键道具: ${scene.keyProps.join('、')}`);
  }

  return parts.join('；');
}

/**
 * Resolve a script character to its enriched context using library data.
 *
 * @param scriptCharId - The script-level character ID.
 * @param scriptCharName - The script-level character name.
 * @param libraryCharId - The library character ID (from `ScriptCharacter.characterLibraryId`).
 * @param libraryCharacters - The full library character list to search.
 * @returns Resolved context with library data merged in.
 */
export function resolveCharacterContext(
  scriptCharId: string,
  scriptCharName: string,
  libraryCharId: string | undefined,
  libraryCharacters: LibraryCharacterSnapshot[],
): ResolvedCharacterContext {
  // Try to find the library character by ID first, then by name
  const libraryChar = libraryCharId
    ? libraryCharacters.find((c) => c.id === libraryCharId)
    : libraryCharacters.find((c) => c.name === scriptCharName);

  if (libraryChar) {
    return {
      scriptCharacterId: scriptCharId,
      libraryCharacterId: libraryChar.id,
      name: scriptCharName || libraryChar.name,
      promptDescription: buildCharacterPromptDescription(libraryChar),
      visualTraits: libraryChar.visualTraits || '',
      referenceImageUrl: libraryChar.thumbnailUrl || null,
      tags: libraryChar.tags || [],
    };
  }

  // No library match — return minimal context
  return {
    scriptCharacterId: scriptCharId,
    libraryCharacterId: libraryCharId || null,
    name: scriptCharName,
    promptDescription: scriptCharName ? `角色名: ${scriptCharName}` : '',
    visualTraits: '',
    referenceImageUrl: null,
    tags: [],
  };
}

/**
 * Resolve a script scene to its enriched context using library data.
 *
 * @param scriptSceneId - The script-level scene ID.
 * @param scriptSceneName - The script-level scene name.
 * @param librarySceneId - The library scene ID (from `ScriptScene.sceneLibraryId`).
 * @param libraryScenes - The full library scene list to search.
 * @returns Resolved context with library data merged in.
 */
export function resolveSceneContext(
  scriptSceneId: string,
  scriptSceneName: string | undefined,
  librarySceneId: string | undefined,
  libraryScenes: LibrarySceneSnapshot[],
): ResolvedSceneContext {
  const libraryScene = librarySceneId
    ? libraryScenes.find((s) => s.id === librarySceneId)
    : scriptSceneName
      ? libraryScenes.find((s) => s.name === scriptSceneName)
      : undefined;

  if (libraryScene) {
    return {
      scriptSceneId,
      librarySceneId: libraryScene.id,
      name: scriptSceneName || libraryScene.name,
      promptDescription: buildScenePromptDescription(libraryScene),
      location: libraryScene.location || '',
      time: libraryScene.time || '',
      atmosphere: libraryScene.atmosphere || '',
      referenceImageUrl: libraryScene.referenceImage || null,
      tags: libraryScene.tags || [],
    };
  }

  // No library match — return minimal context
  return {
    scriptSceneId,
    librarySceneId: librarySceneId || null,
    name: scriptSceneName || '',
    promptDescription: scriptSceneName ? `场景: ${scriptSceneName}` : '',
    location: '',
    time: '',
    atmosphere: '',
    referenceImageUrl: null,
    tags: [],
  };
}
