import { getScriptWorkspaceFs } from '@/lib/script-workspace-fs';
import { useScriptWorkspaceStore } from '@/stores/script-workspace-store';
import type { BlueprintMediaRef, BlueprintProject } from '@/types/blueprint';

export const BLUEPRINT_PROJECT_FILE = 'blueprint-project.json';
const MEDIA_PREFIX = 'workspace-media://';

type SavedBlueprintFile = {
  format: 'moyin-blueprint-project';
  version: 1;
  savedAt: number;
  blueprint: BlueprintProject;
};

function extension(ref: BlueprintMediaRef): string {
  const mime = ref.mimeType?.split('/')[1]?.split(';')[0];
  if (mime) return `.${mime === 'jpeg' ? 'jpg' : mime}`;
  const name = ref.localPath?.split(/[\\/]/).pop() ?? '';
  const match = name.match(/\.[a-z0-9]+$/i);
  return match?.[0] ?? '.bin';
}

function isMediaRef(value: unknown): value is BlueprintMediaRef {
  return !!value && typeof value === 'object' &&
    ('url' in value || 'localPath' in value || 'mimeType' in value);
}

async function persistRefs(value: unknown, root: string, fs: NonNullable<ReturnType<typeof getScriptWorkspaceFs>>, counters: { image: number; video: number }): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((item) => persistRefs(item, root, fs, counters)));
  if (!value || typeof value !== 'object') return value;
  if (isMediaRef(value)) {
    const url = value.url;
    if (!url || url.startsWith(MEDIA_PREFIX)) return { ...value };
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      return { ...value };
    }
    if (!response.ok) return { ...value };
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const isVideo = value.mimeType?.startsWith('video/') || (value as BlueprintMediaRef & { assetType?: string }).assetType === 'video';
    const folder = isVideo ? 'video' : 'photo';
    const index = isVideo ? ++counters.video : ++counters.image;
    const relativePath = `${folder}/blueprint-${Date.now()}-${index}${extension(value)}`;
    if (fs.writeBinary) await fs.writeBinary(root, relativePath, btoa(binary));
    else if (fs.writeImage && !isVideo) await fs.writeImage(root, relativePath, btoa(binary));
    else throw new Error('当前应用版本不支持保存媒体文件，请完全重启应用后重试');
    return { ...value, url: `${MEDIA_PREFIX}${relativePath}`, localPath: relativePath };
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = await persistRefs(item, root, fs, counters);
  return result;
}

async function resolveRefs(value: unknown, root: string, fs: NonNullable<ReturnType<typeof getScriptWorkspaceFs>>): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((item) => resolveRefs(item, root, fs)));
  if (!value || typeof value !== 'object') return value;
  if (isMediaRef(value) && typeof value.url === 'string' && value.url.startsWith(MEDIA_PREFIX)) {
    const relativePath = value.url.slice(MEDIA_PREFIX.length);
    const dataUrl = fs.readBinary
      ? await fs.readBinary(root, relativePath, value.mimeType).catch(() => null)
      : fs.readImage ? await fs.readImage(root, relativePath).catch(() => null) : null;
    return { ...value, url: dataUrl ?? value.url };
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = await resolveRefs(item, root, fs);
  return result;
}

export async function saveBlueprintProject(blueprint: BlueprintProject): Promise<string> {
  const fs = getScriptWorkspaceFs();
  const root = useScriptWorkspaceStore.getState().workspaceRoot;
  if (!fs || !root) throw new Error('请先在资源管理器中打开工作区文件夹');
  const persisted = await persistRefs(blueprint, root, fs, { image: 0, video: 0 });
  const file: SavedBlueprintFile = { format: 'moyin-blueprint-project', version: 1, savedAt: Date.now(), blueprint: persisted as BlueprintProject };
  await fs.writeFile(root, BLUEPRINT_PROJECT_FILE, JSON.stringify(file, null, 2));
  return BLUEPRINT_PROJECT_FILE;
}

export async function loadBlueprintProject(): Promise<BlueprintProject> {
  const fs = getScriptWorkspaceFs();
  const root = useScriptWorkspaceStore.getState().workspaceRoot;
  if (!fs || !root) throw new Error('请先在资源管理器中打开工作区文件夹');
  const raw = JSON.parse(await fs.readFile(root, BLUEPRINT_PROJECT_FILE)) as SavedBlueprintFile | BlueprintProject;
  const blueprint = 'blueprint' in raw ? raw.blueprint : raw;
  return await resolveRefs(blueprint, root, fs) as BlueprintProject;
}