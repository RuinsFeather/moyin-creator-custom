// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Skill Library (§5.3)
//
// Renderer-side facade over the `skills:list` / `skills:listCustom` IPC
// handlers. Provides:
//   - listSkills()        — built-in + custom skills, merged & deduped by name
//   - getSkillContent()   — skill body by name (from cache)
//   - subscribeSkills()   — change notification (for settings panels)
//   - Custom directory management (dialog:openDirectory + localStorage)
//
// Web (non-Electron) environments degrade to an empty list — AI assist
// simply shows no skill chips there.
//
// Skill bodies are NOT persisted into node configs; configs store skill
// names only (`TextBoxConfig.skillRefs`) and content is resolved fresh
// at request time to avoid config bloat and version drift.

// ── Types ────────────────────────────────────────────────────────────────

export interface SkillInfo {
  /** Unique skill name (frontmatter `name`, fallback: file name). */
  name: string;
  /** Short description from frontmatter (shown as chip tooltip). */
  description?: string;
  /** Absolute file path of the skill markdown. */
  filePath: string;
  /** Full markdown body, including frontmatter. */
  content: string;
}

type SkillsListener = (skills: SkillInfo[]) => void;

interface IpcRendererLike {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

/** localStorage key persisting the custom skill directory (non-project data). */
const CUSTOM_DIR_STORAGE_KEY = 'moyin-skill-custom-dir';

// ── Frontmatter parsing (pure, exported for tests) ──────────────────────

/**
 * Parse the `---` delimited frontmatter block of a skill markdown file.
 * Only `name` and `description` keys are extracted; surrounding quotes
 * are stripped. Returns `{}` when no frontmatter is present.
 */
export function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim().replace(/^["'](.*)["']$/s, '$1').trim();
    if (key === 'name' && value) result.name = value;
    if (key === 'description' && value) result.description = value;
  }
  return result;
}

/**
 * Build a SkillInfo from a raw file record (name fallback = file name
 * without extension). Exported for tests and the AI panel.
 */
export function toSkillInfo(raw: {
  name?: string;
  filePath: string;
  content: string;
}): SkillInfo {
  const fm = parseSkillFrontmatter(raw.content);
  const fallbackName = raw.filePath
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(md|markdown)$/i, '');
  return {
    name: fm.name || fallbackName,
    description: fm.description,
    filePath: raw.filePath,
    content: raw.content,
  };
}

/**
 * Merge built-in and custom skills, deduping by name — built-ins win
 * (custom skills with colliding names are shadowed). Order: built-ins
 * first, then custom additions.
 */
export function mergeSkills(builtIn: SkillInfo[], custom: SkillInfo[]): SkillInfo[] {
  const byName = new Map<string, SkillInfo>();
  for (const skill of builtIn) {
    if (!byName.has(skill.name)) byName.set(skill.name, skill);
  }
  for (const skill of custom) {
    if (!byName.has(skill.name)) byName.set(skill.name, skill);
  }
  return [...byName.values()];
}

// ── Environment detection ────────────────────────────────────────────────

function getIpc(): IpcRendererLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ipcRenderer?: IpcRendererLike };
  return w.ipcRenderer ?? null;
}

export function isElectronRenderer(): boolean {
  return getIpc() !== null;
}

// ── Cache & subscriptions ────────────────────────────────────────────────

let cache: SkillInfo[] | null = null;
let cachePromise: Promise<SkillInfo[]> | null = null;
const listeners = new Set<SkillsListener>();

function notifyListeners(): void {
  const snapshot = cache ?? [];
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // Listener errors must not break other subscribers.
    }
  }
}

/**
 * Subscribe to skill-list changes (custom dir changes, refreshes).
 * Returns an unsubscribe function.
 */
export function subscribeSkills(listener: SkillsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ── Custom directory management ──────────────────────────────────────────

export function getCustomSkillDir(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(CUSTOM_DIR_STORAGE_KEY) || null;
}

export function setCustomSkillDir(dir: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (dir) {
    localStorage.setItem(CUSTOM_DIR_STORAGE_KEY, dir);
  } else {
    localStorage.removeItem(CUSTOM_DIR_STORAGE_KEY);
  }
  // Invalidate cache so the next listSkills() re-reads the custom dir.
  void refreshSkills();
}

/**
 * Open a native directory picker and persist the chosen custom skill dir.
 * Returns the picked path (or null when canceled). Only works in Electron.
 */
export async function pickCustomSkillDir(): Promise<string | null> {
  const ipc = getIpc();
  if (!ipc) return null;
  try {
    const result = (await ipc.invoke('dialog:openDirectory')) as {
      canceled?: boolean;
      filePaths?: string[];
    };
    if (result.canceled || !result.filePaths?.length) return null;
    const dir = result.filePaths[0];
    setCustomSkillDir(dir);
    return dir;
  } catch {
    return null;
  }
}

// ── Listing ──────────────────────────────────────────────────────────────

interface RawSkillsResult {
  skills?: Array<{ name?: string; description?: string; filePath: string; content: string }>;
  error?: string;
}

async function listDirSkills(channel: string, dir?: string): Promise<SkillInfo[]> {
  const ipc = getIpc();
  if (!ipc) return [];
  try {
    const result = dir
      ? ((await ipc.invoke(channel, dir)) as RawSkillsResult)
      : ((await ipc.invoke(channel)) as RawSkillsResult);
    if (!result || typeof result !== 'object' || result.error || !Array.isArray(result.skills)) {
      return [];
    }
    return result.skills
      .filter((s) => typeof s?.filePath === 'string' && typeof s?.content === 'string')
      .map((s) => ({
        name: s.name || '',
        description: s.description,
        filePath: s.filePath,
        content: s.content,
      }))
      .filter((s) => s.name !== '');
  } catch {
    return [];
  }
}

/**
 * List all skills: built-in (`skills:list`) + custom dir
 * (`skills:listCustom`, when configured), merged and deduped by name.
 * Results are cached in memory; concurrent calls share one promise.
 */
export async function listSkills(): Promise<SkillInfo[]> {
  if (cache) return cache;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
    const [builtIn, customDir] = await Promise.all([
      listDirSkills('skills:list'),
      Promise.resolve(getCustomSkillDir()),
    ]);
    const custom = customDir ? await listDirSkills('skills:listCustom', customDir) : [];
    cache = mergeSkills(builtIn, custom);
    return cache;
  })();

  try {
    return await cachePromise;
  } finally {
    cachePromise = null;
  }
}

/**
 * Force a re-read of all skill sources and notify subscribers.
 */
export async function refreshSkills(): Promise<SkillInfo[]> {
  cache = null;
  cachePromise = null;
  const skills = await listSkills();
  notifyListeners();
  return skills;
}

/**
 * Resolve a skill's full content by name. Returns null when the skill
 * is not in the library (e.g., removed after the config was written).
 */
export async function getSkillContent(name: string): Promise<string | null> {
  const skills = await listSkills();
  return skills.find((s) => s.name === name)?.content ?? null;
}

/**
 * Clear the in-memory cache (test helper).
 */
export function clearSkillCache(): void {
  cache = null;
  cachePromise = null;
}
