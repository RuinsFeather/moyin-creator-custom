// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBlueprintProject, saveBlueprintProject } from '../blueprint-project-file-service';
import { getScriptWorkspaceFs } from '@/lib/script-workspace-fs';
import { useScriptWorkspaceStore } from '@/stores/script-workspace-store';
import type { BlueprintProject } from '@/types/blueprint';

vi.mock('@/lib/script-workspace-fs', () => ({ getScriptWorkspaceFs: vi.fn() }));

const mockedGetFs = vi.mocked(getScriptWorkspaceFs);

function blueprint(): BlueprintProject {
  return {
    id: 'bp-1', projectId: 'project-1', name: '测试蓝图', version: 1,
    nodes: [{ id: 'image-1', type: 'image-box', position: { x: 0, y: 0 }, data: {
      nodeType: 'image-box', label: '图片', config: {
        media: [{ url: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png', localPath: 'a.png' }],
      },
    }} as BlueprintProject['nodes'][number]],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, status: 'draft', createdAt: 1, updatedAt: 1,
  };
}

describe('blueprint-project-file-service', () => {
  beforeEach(() => {
    useScriptWorkspaceStore.setState({ workspaceRoot: 'C:/workspace' });
  });

  it('writes media under photo and stores only a stable reference in JSON', async () => {
    const files = new Map<string, string>();
    const writeBinary = vi.fn(async (_root: string, path: string, data: string) => {
      files.set(path, data); return { mtime: 1, size: data.length };
    });
    const writeFile = vi.fn(async (_root: string, path: string, data: string) => {
      files.set(path, data); return { mtime: 1, size: data.length };
    });
    mockedGetFs.mockReturnValue({ writeFile, writeBinary } as unknown as ReturnType<typeof getScriptWorkspaceFs>);

    await saveBlueprintProject(blueprint());
    expect(writeBinary).toHaveBeenCalledWith('C:/workspace', expect.stringMatching(/^photo\//), expect.any(String));
    const saved = JSON.parse(files.get('blueprint-project.json')!);
    expect(JSON.stringify(saved)).not.toContain('aGVsbG8=');
    expect(saved.blueprint.nodes[0].data.config.media[0].url).toMatch(/^workspace-media:\/\/photo\//);
  });

  it('resolves stable media references when opening a saved project', async () => {
    const json = JSON.stringify({ format: 'moyin-blueprint-project', version: 1, savedAt: 1, blueprint: {
      ...blueprint(), nodes: [{ ...blueprint().nodes[0], data: { ...blueprint().nodes[0].data, config: {
        media: [{ url: 'workspace-media://video/clip.mp4', mimeType: 'video/mp4' }],
      }}}],
    }});
    const readFile = vi.fn(async () => json);
    const readBinary = vi.fn(async () => 'data:video/mp4;base64,AAAA');
    mockedGetFs.mockReturnValue({ readFile, readBinary } as unknown as ReturnType<typeof getScriptWorkspaceFs>);

    const loaded = await loadBlueprintProject();
    const media = (loaded.nodes[0].data.config as { media: Array<{ url: string }> }).media[0];
    expect(readBinary).toHaveBeenCalledWith('C:/workspace', 'video/clip.mp4', 'video/mp4');
    expect(media.url).toBe('data:video/mp4;base64,AAAA');
  });
});