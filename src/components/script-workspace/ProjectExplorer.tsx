// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useScriptWorkspaceStore, type ScriptFileEntry } from '@/stores/script-workspace-store';
import { cn, generateUUID } from '@/lib/utils';
import {
  ChevronDownIcon, ChevronRightIcon, CopyIcon, FileIcon, FileTextIcon,
  FolderIcon, FolderOpenIcon, FolderPlusIcon, PencilIcon, PlusIcon,
  RefreshCwIcon, SearchIcon, Trash2Icon,
} from 'lucide-react';
import { toast } from 'sonner';
import { getScriptWorkspaceFs } from '@/lib/script-workspace-fs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';

const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.markdown']);
type EntryKind = 'file' | 'directory';
type SelectedEntry = { path: string; kind: EntryKind };
type TreeNode = { name: string; path: string; kind: EntryKind; file?: ScriptFileEntry; children: TreeNode[] };
type EditOperation = { type: 'create-file' | 'create-directory' | 'rename'; entry?: SelectedEntry };

const SCRIPT_REFERENCE_TEMPLATE = `# 《雨停之前》

> 这是一份标准中文剧本格式参考。你可以保留结构，也可以直接替换其中的故事内容。

**大纲：**
暴雨将至，年轻记者林夏为了寻找失联的父亲，回到多年未曾踏足的临江小镇。她在旧车站遇见了正在修理钟表的周野，两人从一张被雨水浸湿的车票入手，发现父亲当年离开的真相，也重新理解了“回家”的意义。

**人物小传：**
- 林夏：二十八岁，城市记者，敏锐、倔强，不愿面对父亲失踪留下的遗憾。
- 周野：三十岁，旧车站钟表匠，沉默细致，一直替小镇保管着一段往事。
- 林父：林夏的父亲，曾是临江车站的调度员，温和而坚定。

## 第一集

## 场次：日 / 外 / 临江镇旧车站

△ 乌云压过屋檐，雨点先是稀疏，随后密集地砸在铁皮站牌上。

△ 林夏拖着行李箱走下出租车。她抬头看向斑驳的“临江站”三个字，手指不自觉地收紧。

林夏（低声）：
我还是回来了。

【字幕：临江镇，下午五点四十分】

## 场次：日 / 内 / 旧车站候车室

△ 候车室空无一人，墙上的老钟停在十年前的六点零七分。

△ 周野站在长椅旁修理一只怀表。他没有抬头，却准确地说出了林夏的名字。

周野：
你比照片里高了。

林夏：
你认识我父亲？

周野（停下手里的动作）：
认识。他一直在等一场雨停。

林夏：
他在哪里？

△ 周野从怀表夹层里取出一张车票，放到林夏面前。车票上的日期，正是林父失踪的那一天。

周野：
先看看这个，再决定要不要找他。

【转场：切至临江河堤】

△ 林夏站在河堤上，展开被雨水浸软的车票。远处的渡船亮起一盏孤灯。

（风声渐大，雨幕遮住了她的表情。）

<!-- 注释：此处可以继续补写林夏发现车票秘密后的反应。 -->

林夏（画外音）：
如果你真的来过这里，为什么不肯见我？

【字幕：未完待续】

## 写作提示

- 场次：使用“时间 / 内外景 / 地点”说明场景位置。
- 动作：使用 △ 描写可被观众看到或听到的内容。
- 角色与对话：角色单独成行，对白写在下一行。
- 括号：补充语气、动作或画外音等表演提示。
- 转场与字幕：使用【转场：】和【字幕：】标记。
- 注释：使用 HTML 注释记录不会出现在成片中的创作提示。
`;

function dirname(path: string): string { return path.split('/').slice(0, -1).join('/'); }
function basename(path: string): string { return path.split('/').pop() ?? path; }
function joinPath(parent: string, name: string): string { return parent ? `${parent}/${name}` : name; }
function isSafeRelativePath(path: string): boolean {
  return Boolean(path) && !path.startsWith('/') && !path.includes('\0')
    && path.split('/').every((part) => part && part !== '.' && part !== '..');
}
function isEditableFile(path: string): boolean {
  return ALLOWED_EXTENSIONS.has(path.slice(path.lastIndexOf('.')).toLowerCase());
}
function copyName(path: string, occupied: Set<string>): string {
  const parent = dirname(path); const name = basename(path); const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name; const extension = dot > 0 ? name.slice(dot) : '';
  let candidate = joinPath(parent, `${stem} - 副本${extension}`); let index = 2;
  while (occupied.has(candidate)) candidate = joinPath(parent, `${stem} - 副本 ${index++}${extension}`);
  return candidate;
}

export function ProjectExplorer() {
  const { files, directories, workspaceRoot, activeFileId, setActiveFile, setFiles, setDirectories, setWorkspaceRoot, addAgentContextFile } = useScriptWorkspaceStore();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry | null>(null);
  const [draggedEntry, setDraggedEntry] = useState<SelectedEntry | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [operation, setOperation] = useState<EditOperation | null>(null);
  const [operationValue, setOperationValue] = useState('');
  const [useScriptReference, setUseScriptReference] = useState(false);
  const [isOperating, setIsOperating] = useState(false);

  const refresh = useCallback(async (root = workspaceRoot) => {
    const workspaceFs = getScriptWorkspaceFs(); if (!root || !workspaceFs) return;
    setIsRefreshing(true);
    try {
      const resources = await workspaceFs.scan(root); const previous = new Map(files.map((file) => [file.path, file]));
      setFiles(resources.filter((item) => item.kind === 'file').map((item) => {
        const old = previous.get(item.relativePath);
        return { id: old?.id ?? generateUUID(), name: item.name, path: item.relativePath, type: item.editable ? 'markdown' : 'metadata', content: old?.isDirty ? old.content : item.content ?? '', lastModified: item.mtime ?? Date.now(), isDirty: old?.isDirty ?? false, editable: item.editable, size: item.size };
      }));
      setDirectories(resources.filter((item) => item.kind === 'directory').map((item) => ({ path: item.relativePath, name: item.name })));
    } catch (error) { toast.error(`刷新失败: ${error instanceof Error ? error.message : '未知错误'}`); }
    finally { setIsRefreshing(false); }
  }, [workspaceRoot, files, setFiles, setDirectories]);

  useEffect(() => { if (workspaceRoot) void refresh(workspaceRoot); }, [workspaceRoot]);

  const targetDirectory = useCallback((entry = selectedEntry) => !entry ? '' : entry.kind === 'directory' ? entry.path : dirname(entry.path), [selectedEntry]);
  const openOperation = useCallback((type: EditOperation['type'], entry?: SelectedEntry) => {
    if (!workspaceRoot || !getScriptWorkspaceFs()) return toast.info('请先打开工作区文件夹');
    const parent = targetDirectory(entry); setOperation({ type, entry });
    setOperationValue(type === 'rename' && entry ? basename(entry.path) : type === 'create-file' ? joinPath(parent, '新文档.md') : joinPath(parent, '新文件夹'));
    setUseScriptReference(false);
  }, [workspaceRoot, targetDirectory]);

  const handleOperation = useCallback(async () => {
    const workspaceFs = getScriptWorkspaceFs(); if (!workspaceRoot || !workspaceFs || !operation) return;
    const value = operationValue.trim().replace(/\\/g, '/');
    const targetPath = operation.type === 'rename' && operation.entry ? joinPath(dirname(operation.entry.path), value) : value;
    if (!isSafeRelativePath(targetPath)) return toast.error('请输入工作区内的有效相对路径');
    if (operation.type === 'create-file' && !isEditableFile(targetPath)) return toast.error('文档仅支持 .md、.markdown 或 .txt');
    setIsOperating(true);
    try {
      if (operation.type === 'create-file') {
        await workspaceFs.writeFile(
          workspaceRoot,
          targetPath,
          useScriptReference ? SCRIPT_REFERENCE_TEMPLATE : '# 新文档\n\n开始写作...',
        );
      }
      else if (operation.type === 'create-directory') await workspaceFs.createDirectory(workspaceRoot, targetPath);
      else if (operation.entry) { await workspaceFs.move(workspaceRoot, operation.entry.path, targetPath); setSelectedEntry({ path: targetPath, kind: operation.entry.kind }); }
      setExpandedFolders((previous) => new Set(previous).add(dirname(targetPath))); await refresh();
      if (operation.type === 'create-file') { const created = useScriptWorkspaceStore.getState().files.find((file) => file.path === targetPath); if (created) setActiveFile(created.id); }
      toast.success(operation.type === 'rename' ? '已重命名' : useScriptReference ? '已创建标准剧本参考文档' : '创建成功'); setOperation(null); setUseScriptReference(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : '操作失败'); }
    finally { setIsOperating(false); }
  }, [workspaceRoot, operation, operationValue, useScriptReference, refresh, setActiveFile]);

  const deleteEntry = useCallback(async (entry: SelectedEntry) => {
    const workspaceFs = getScriptWorkspaceFs(); if (!workspaceRoot || !workspaceFs || !window.confirm(`确定删除 ${entry.path}？此操作不可撤销。`)) return;
    try { await workspaceFs.remove(workspaceRoot, entry.path); if (selectedEntry?.path === entry.path) setSelectedEntry(null); await refresh(); toast.success('已删除'); }
    catch (error) { toast.error(error instanceof Error ? error.message : '删除失败'); }
  }, [workspaceRoot, selectedEntry, refresh]);

  const duplicateEntry = useCallback(async (entry: SelectedEntry) => {
    const workspaceFs = getScriptWorkspaceFs(); if (!workspaceRoot || !workspaceFs) return;
    const occupied = new Set([...files.map((file) => file.path), ...directories.map((directory) => directory.path)]); const destination = copyName(entry.path, occupied);
    try { await workspaceFs.copy(workspaceRoot, entry.path, destination); await refresh(); setSelectedEntry({ path: destination, kind: entry.kind }); toast.success(`已复制为 ${basename(destination)}`); }
    catch (error) { toast.error(error instanceof Error ? error.message : '复制失败'); }
  }, [workspaceRoot, files, directories, refresh]);

  const moveEntry = useCallback(async (entry: SelectedEntry, destinationDirectory: string) => {
    const workspaceFs = getScriptWorkspaceFs(); if (!workspaceRoot || !workspaceFs) return;
    if (entry.kind === 'directory' && (destinationDirectory === entry.path || destinationDirectory.startsWith(`${entry.path}/`))) return toast.error('不能将文件夹移动到自身或其子目录');
    const destination = joinPath(destinationDirectory, basename(entry.path)); if (destination === entry.path) return;
    try { await workspaceFs.move(workspaceRoot, entry.path, destination); setExpandedFolders((previous) => new Set(previous).add(destinationDirectory)); setSelectedEntry({ path: destination, kind: entry.kind }); await refresh(); toast.success(`已移动到 ${destinationDirectory || '工作区根目录'}`); }
    catch (error) { toast.error(error instanceof Error ? error.message : '移动失败'); }
  }, [workspaceRoot, refresh]);

  const handleOpenFile = useCallback((file: ScriptFileEntry) => { if (!file.editable) return toast.info('该文件不支持文本编辑'); setActiveFile(file.id); }, [setActiveFile]);
  const selectFile = useCallback((file: ScriptFileEntry, entry: SelectedEntry) => {
    setSelectedEntry(entry);
    addAgentContextFile({ id: file.id, name: file.name, path: file.path, source: 'workspace', active: false });
  }, [addAgentContextFile]);
  const handleImportFolder = useCallback(async () => {
    const workspaceFs = getScriptWorkspaceFs(); if (!workspaceFs) return toast.info('请通过 npm run dev 启动 Electron');
    const root = await workspaceFs.selectRoot(); if (!root) return; setWorkspaceRoot(root); setExpandedFolders(new Set()); setSelectedEntry(null); await refresh(root);
  }, [setWorkspaceRoot, refresh]);

  const tree = useMemo(() => {
    const root: TreeNode = { name: '', path: '', kind: 'directory', children: [] }; const directoryNodes = new Map<string, TreeNode>([['', root]]);
    [...directories].sort((a, b) => a.path.localeCompare(b.path)).forEach((directory) => { const node: TreeNode = { name: directory.name, path: directory.path, kind: 'directory', children: [] }; (directoryNodes.get(dirname(directory.path)) ?? root).children.push(node); directoryNodes.set(directory.path, node); });
    files.forEach((file) => (directoryNodes.get(dirname(file.path)) ?? root).children.push({ name: file.name, path: file.path, kind: 'file', file, children: [] }));
    const sort = (node: TreeNode) => { node.children.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN') : a.kind === 'directory' ? -1 : 1); node.children.forEach(sort); }; sort(root); return root.children;
  }, [directories, files]);

  const commonMenu = (entry: SelectedEntry) => <ContextMenuContent className="w-52">
    {entry.kind === 'file' && <ContextMenuItem onClick={() => { const file = files.find((item) => item.path === entry.path); if (file) handleOpenFile(file); }}><FileTextIcon className="mr-2 h-4 w-4" />打开</ContextMenuItem>}
    {entry.kind === 'directory' && <><ContextMenuItem onClick={() => openOperation('create-file', entry)}><PlusIcon className="mr-2 h-4 w-4" />新建文件</ContextMenuItem><ContextMenuItem onClick={() => openOperation('create-directory', entry)}><FolderPlusIcon className="mr-2 h-4 w-4" />新建文件夹</ContextMenuItem><ContextMenuSeparator /></>}
    <ContextMenuItem onClick={() => void duplicateEntry(entry)}><CopyIcon className="mr-2 h-4 w-4" />复制</ContextMenuItem>
    <ContextMenuItem onClick={() => openOperation('rename', entry)}><PencilIcon className="mr-2 h-4 w-4" />重命名</ContextMenuItem>
    <ContextMenuItem onClick={() => { const fs = getScriptWorkspaceFs(); if (workspaceRoot && fs) void fs.reveal(workspaceRoot, entry.path); }}><SearchIcon className="mr-2 h-4 w-4" />在文件资源管理器中显示</ContextMenuItem>
    <ContextMenuSeparator /><ContextMenuItem variant="destructive" onClick={() => void deleteEntry(entry)}><Trash2Icon className="mr-2 h-4 w-4" />删除</ContextMenuItem>
  </ContextMenuContent>;

  const renderNodes = (nodes: TreeNode[], depth = 0): React.ReactNode => nodes.map((node) => {
    const entry: SelectedEntry = { path: node.path, kind: node.kind }; const selected = selectedEntry?.path === node.path;
    if (node.kind === 'directory') { const expanded = expandedFolders.has(node.path); return <ContextMenu key={node.path} onOpenChange={(open) => open && setSelectedEntry(entry)}><div><ContextMenuTrigger asChild><button draggable onDragStart={(event) => { setDraggedEntry(entry); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDraggedEntry(null); setDropTarget(null); }} onDragOver={(event) => { event.preventDefault(); setDropTarget(node.path); }} onDragLeave={() => setDropTarget((current) => current === node.path ? null : current)} onDrop={(event) => { event.preventDefault(); setDropTarget(null); if (draggedEntry) void moveEntry(draggedEntry, node.path); }} onClick={() => { setSelectedEntry(entry); setExpandedFolders((previous) => { const next = new Set(previous); if (next.has(node.path)) next.delete(node.path); else next.add(node.path); return next; }); }} className={cn('flex items-center w-full py-1 text-xs text-muted-foreground hover:bg-muted/50', selected && 'bg-primary/15 text-foreground', dropTarget === node.path && 'ring-1 ring-inset ring-primary bg-primary/10')} style={{ paddingLeft: 8 + depth * 12 }}>{expanded ? <ChevronDownIcon className="h-3 w-3 mr-1" /> : <ChevronRightIcon className="h-3 w-3 mr-1" />}{expanded ? <FolderOpenIcon className="h-3.5 w-3.5 mr-1.5" /> : <FolderIcon className="h-3.5 w-3.5 mr-1.5" />}<span className="truncate">{node.name}</span></button></ContextMenuTrigger>{expanded && renderNodes(node.children, depth + 1)}</div>{commonMenu(entry)}</ContextMenu>; }
    const file = node.file!; return <ContextMenu key={node.path} onOpenChange={(open) => open && selectFile(file, entry)}><ContextMenuTrigger asChild><button draggable onDragStart={(event) => { setDraggedEntry(entry); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-moyin-script-file', file.path); }} onDragEnd={() => setDraggedEntry(null)} onClick={() => selectFile(file, entry)} onDoubleClick={() => handleOpenFile(file)} className={cn('w-full flex items-center py-1.5 text-xs hover:bg-muted/50', selected && 'bg-primary/15', activeFileId === file.id && 'text-primary', !file.editable && 'text-muted-foreground')} style={{ paddingLeft: 12 + depth * 12 }}><FileTextIcon className="h-3.5 w-3.5 mr-2" /><span className="truncate flex-1 text-left">{file.name}</span>{file.isDirty && <span className="w-2 h-2 rounded-full bg-yellow-500 mr-2" />}</button></ContextMenuTrigger>{commonMenu(entry)}</ContextMenu>;
  });

  return <div className="h-full flex flex-col bg-panel"><div className="flex items-center justify-between px-3 py-2 border-b border-border"><span className="text-xs font-medium text-muted-foreground truncate" title={workspaceRoot ?? ''}>资源管理器</span><div className="flex gap-1"><button onClick={() => openOperation('create-file')} className="p-1 hover:bg-muted rounded" title="新建文件"><PlusIcon className="h-3.5 w-3.5" /></button><button onClick={() => openOperation('create-directory')} className="p-1 hover:bg-muted rounded" title="新建文件夹"><FolderPlusIcon className="h-3.5 w-3.5" /></button><button onClick={() => void refresh()} disabled={!workspaceRoot || isRefreshing} className="p-1 hover:bg-muted rounded disabled:opacity-40" title="刷新"><RefreshCwIcon className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} /></button><button onClick={handleImportFolder} className="p-1 hover:bg-muted rounded" title="打开工作区"><FolderOpenIcon className="h-3.5 w-3.5" /></button></div></div>
    <ContextMenu onOpenChange={(open) => open && setSelectedEntry(null)}><ContextMenuTrigger asChild><div className={cn('flex-1 overflow-y-auto py-1', dropTarget === '' && 'ring-1 ring-inset ring-primary')} onClick={(event) => { if (event.target === event.currentTarget) setSelectedEntry(null); }} onDragOver={(event) => { event.preventDefault(); setDropTarget(''); }} onDragLeave={(event) => { if (event.target === event.currentTarget) setDropTarget(null); }} onDrop={(event) => { event.preventDefault(); setDropTarget(null); if (draggedEntry) void moveEntry(draggedEntry, ''); }}>{!workspaceRoot ? <div className="flex flex-col items-center justify-center h-32 text-muted-foreground"><FileIcon className="h-8 w-8 mb-2 opacity-50" /><p className="text-xs">尚未打开工作区</p></div> : renderNodes(tree)}</div></ContextMenuTrigger><ContextMenuContent className="w-48"><ContextMenuItem onClick={() => openOperation('create-file')}><PlusIcon className="mr-2 h-4 w-4" />新建文件</ContextMenuItem><ContextMenuItem onClick={() => openOperation('create-directory')}><FolderPlusIcon className="mr-2 h-4 w-4" />新建文件夹</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem onClick={() => void refresh()}><RefreshCwIcon className="mr-2 h-4 w-4" />刷新</ContextMenuItem></ContextMenuContent></ContextMenu>
    <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground">{directories.length} 个文件夹 · {files.length} 个文件</div>
    <Dialog open={operation !== null} onOpenChange={(open) => { if (!open && !isOperating) { setOperation(null); setUseScriptReference(false); } }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{operation?.type === 'rename' ? '重命名' : operation?.type === 'create-directory' ? '新建文件夹' : '新建文件'}</DialogTitle></DialogHeader><Input value={operationValue} onChange={(event) => setOperationValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !isOperating) void handleOperation(); }} autoFocus disabled={isOperating} /><p className="text-xs text-muted-foreground">新项目会创建在当前选中项目所在的文件夹中；选择文件夹时会创建在该文件夹内。</p>{operation?.type === 'create-file' && <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5 text-xs hover:bg-muted/50"><input type="checkbox" checked={useScriptReference} onChange={(event) => setUseScriptReference(event.target.checked)} disabled={isOperating} className="mt-0.5 h-3.5 w-3.5 accent-primary" /><span><span className="font-medium">导入剧本标准格式参考</span><span className="mt-0.5 block text-[11px] text-muted-foreground">创建一份包含完整示例剧情、场次、动作、角色、对白、转场、注释和字幕的参考文档，帮助快速掌握剧本写法。</span></span></label>}<DialogFooter><Button variant="outline" onClick={() => setOperation(null)} disabled={isOperating}>取消</Button><Button onClick={() => void handleOperation()} disabled={!operationValue.trim() || isOperating}>{isOperating ? '处理中…' : '确定'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
