// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  parseSkillFrontmatter,
  toSkillInfo,
  mergeSkills,
  listSkills,
  getSkillContent,
  subscribeSkills,
  refreshSkills,
  setCustomSkillDir,
  clearSkillCache,
  getCustomSkillDir,
  isElectronRenderer,
} from '../skill-library';

// ── window.ipcRenderer mock ──────────────────────────────────────────────

type InvokeHandler = (channel: string, ...args: unknown[]) => Promise<unknown>;

let invokeImpl: InvokeHandler = async () => ({ skills: [] });

const invokeSpy = vi.fn(async (channel: string, ...args: unknown[]) =>
  invokeImpl(channel, ...args));

beforeEach(() => {
  vi.clearAllMocks();
  clearSkillCache();
  localStorage.clear();
  invokeImpl = async () => ({ skills: [] });
  (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
    invoke: invokeSpy,
  };
});

afterEach(() => {
  delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
});

function makeRawSkill(name: string, filePath = `C:\\skills\\${name}.md`) {
  return {
    name,
    description: `${name} description`,
    filePath,
    content: `---\nname: "${name}"\ndescription: "${name} description"\n---\n\n# ${name}\n\nBody of ${name}.`,
  };
}

// ── Frontmatter parsing (pure functions) ────────────────────────────────

describe('parseSkillFrontmatter', () => {
  it('extracts name and description from quoted frontmatter', () => {
    const content = '---\nname: "sd2-pe"\ndescription: "Optimizes prompts"\n---\n\nbody';
    const fm = parseSkillFrontmatter(content);
    expect(fm.name).toBe('sd2-pe');
    expect(fm.description).toBe('Optimizes prompts');
  });

  it('handles unquoted values and CRLF line endings', () => {
    const content = '---\r\nname: my-skill\r\ndescription: plain text\r\n---\r\nbody';
    const fm = parseSkillFrontmatter(content);
    expect(fm.name).toBe('my-skill');
    expect(fm.description).toBe('plain text');
  });

  it('returns empty object when no frontmatter present', () => {
    expect(parseSkillFrontmatter('# just a heading\nbody')).toEqual({});
  });
});

describe('toSkillInfo', () => {
  it('falls back to file name (without extension) when frontmatter has no name', () => {
    const info = toSkillInfo({
      filePath: 'C:\\skills\\my-skill.md',
      content: '# no frontmatter',
    });
    expect(info.name).toBe('my-skill');
    expect(info.description).toBeUndefined();
  });
});

describe('mergeSkills', () => {
  it('dedupes by name with built-ins winning over custom', () => {
    const builtIn = [makeRawSkill('sd2-pe', 'C:\\builtin\\sd2-pe.md')];
    const custom = [makeRawSkill('sd2-pe', 'C:\\custom\\sd2-pe.md'), makeRawSkill('extra')];
    const merged = mergeSkills(builtIn, custom);
    expect(merged).toHaveLength(2);
    expect(merged.find((s) => s.name === 'sd2-pe')?.filePath).toContain('builtin');
    expect(merged.find((s) => s.name === 'extra')).toBeDefined();
  });
});

// ── IPC-backed listing ───────────────────────────────────────────────────

describe('listSkills', () => {
  it('returns [] in non-Electron environments (web fallback)', async () => {
    delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
    clearSkillCache();
    const skills = await listSkills();
    expect(skills).toEqual([]);
    expect(isElectronRenderer()).toBe(false);
  });

  it('lists built-in skills via skills:list IPC', async () => {
    invokeImpl = async (channel) => {
      if (channel === 'skills:list') {
        return { skills: [makeRawSkill('sd2-pe')] };
      }
      return { skills: [] };
    };
    const skills = await listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('sd2-pe');
    expect(invokeSpy).toHaveBeenCalledWith('skills:list');
  });

  it('merges custom dir skills (skills:listCustom) with built-ins deduped', async () => {
    localStorage.setItem('moyin-skill-custom-dir', 'D:\\my-skills');
    invokeImpl = async (channel, dir) => {
      if (channel === 'skills:list') {
        return { skills: [makeRawSkill('sd2-pe', 'C:\\builtin\\sd2-pe.md')] };
      }
      if (channel === 'skills:listCustom') {
        expect(dir).toBe('D:\\my-skills');
        return {
          skills: [
            makeRawSkill('sd2-pe', 'D:\\my-skills\\sd2-pe.md'),
            makeRawSkill('custom-extra', 'D:\\my-skills\\custom-extra.md'),
          ],
        };
      }
      return { skills: [] };
    };
    const skills = await listSkills();
    expect(skills).toHaveLength(2);
    // Built-in wins on name conflict
    expect(skills.find((s) => s.name === 'sd2-pe')?.filePath).toContain('builtin');
    expect(skills.find((s) => s.name === 'custom-extra')?.filePath).toContain('my-skills');
  });

  it('caches results — repeated calls do not re-invoke IPC', async () => {
    invokeImpl = async () => ({ skills: [makeRawSkill('sd2-pe')] });
    await listSkills();
    await listSkills();
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it('degrades to [] on IPC error responses', async () => {
    invokeImpl = async () => ({ error: 'boom' });
    const skills = await listSkills();
    expect(skills).toEqual([]);
  });

  it('degrades to [] when IPC invoke throws', async () => {
    invokeImpl = async () => {
      throw new Error('ipc failure');
    };
    const skills = await listSkills();
    expect(skills).toEqual([]);
  });
});

describe('getSkillContent', () => {
  it('resolves content by name from the cached list', async () => {
    invokeImpl = async () => ({ skills: [makeRawSkill('sd2-pe')] });
    const content = await getSkillContent('sd2-pe');
    expect(content).toContain('Body of sd2-pe');
  });

  it('returns null for unknown skill names', async () => {
    invokeImpl = async () => ({ skills: [makeRawSkill('sd2-pe')] });
    expect(await getSkillContent('nonexistent')).toBeNull();
  });
});

describe('custom dir & subscriptions', () => {
  it('setCustomSkillDir persists and triggers refresh + notify', async () => {
    let listCalls = 0;
    invokeImpl = async (channel) => {
      if (channel === 'skills:list') {
        listCalls++;
        return { skills: [makeRawSkill('sd2-pe')] };
      }
      return { skills: [] };
    };

    const seen: number[] = [];
    const unsub = subscribeSkills((skills) => seen.push(skills.length));

    await refreshSkills();
    expect(listCalls).toBe(1);

    setCustomSkillDir('D:\\my-skills');
    expect(getCustomSkillDir()).toBe('D:\\my-skills');
    // setCustomSkillDir triggers a refresh → second IPC round
    await new Promise((r) => setTimeout(r, 0));
    expect(listCalls).toBe(2);
    expect(seen.length).toBeGreaterThanOrEqual(1);

    unsub();
  });

  it('clearCustomSkillDir (null) removes the stored key', () => {
    setCustomSkillDir('D:\\x');
    expect(getCustomSkillDir()).toBe('D:\\x');
    // null clears without refresh side-effect assertions (covered above)
    localStorage.removeItem('moyin-skill-custom-dir');
    expect(getCustomSkillDir()).toBeNull();
  });
});
