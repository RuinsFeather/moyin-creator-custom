"use client";

// 火山引擎方舟素材资产管理弹窗
// 从 VideoStudio 多功能参考模式中通过按钮打开，提供上传、图库浏览、选择导入功能
// 选中的素材使用 Asset:// URI 直接传递给视频生成 API

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Upload,
  Loader2,
  X,
  Check,
  FolderOpen,
  Search,
  Trash2,
  ExternalLink,
  Copy,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { saveImageToLocal } from "@/lib/image-storage";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// ==================== 类型 ====================

export interface VolcAssetItem {
  /** Asset ID（如 Asset-2026xxxxxxxxxx-xxxxx） */
  assetId: string;
  /** Asset URI（如 Asset://Asset-2026xxxxxxxxxx-xxxxx） */
  assetUri: string;
  /** 处理后的素材 URL（用于缩略图展示） */
  url: string;
  /** 素材名称 */
  name: string;
  /** 所属 GroupId */
  groupId: string;
  /** 所属 GroupName */
  groupName: string;
  /** 上传时间 */
  uploadedAt: number;
}

interface VolcAssetPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当用户选择素材时回调 */
  onSelectAsset: (asset: VolcAssetItem) => void;
  /** 当前已选中的 Asset ID 列表（用于高亮） */
  selectedAssetIds?: string[];
}

function AssetThumbnail({ asset }: { asset: VolcAssetItem }) {
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setLoadFailed(false);
  }, [asset.url]);

  if (!asset.url || loadFailed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
        <FolderOpen className="h-6 w-6 opacity-40" />
        <span className="px-1 text-center text-[10px] leading-tight line-clamp-2">
          缩略图不可用
        </span>
      </div>
    );
  }

  return (
    <img
      src={asset.url}
      alt={asset.name}
      className="h-full w-full object-cover"
      loading="lazy"
      onError={() => setLoadFailed(true)}
    />
  );
}

// ==================== 持久化存储（fileStorage） ====================
const STORAGE_KEY = "volc-asset-library";
const GROUP_STORAGE_KEY = "volc-asset-group";

/** 按 groupId 存储素材列表的 key */
function getGroupAssetsKey(groupId: string): string {
  return `volc-assets/${groupId}`;
}

interface StoredGroup {
  groupId: string;
  groupName: string;
}

function sanitizeAssetFileName(name: string): string {
  const baseName = name.replace(/\.[^.]+$/, "").slice(0, 40);
  return baseName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_") || "volc_asset";
}

function isPersistentThumbnail(url: string): boolean {
  return !url || url.startsWith("local-image://") || url.startsWith("data:");
}

async function saveAssetThumbnailLocally(sourceUrl: string, fileName: string): Promise<string> {
  const ext = fileName.match(/\.(png|jpe?g|webp|gif|bmp|tiff)$/i)?.[1]?.toLowerCase() || "png";
  const safeName = `${sanitizeAssetFileName(fileName)}_${Date.now()}.${ext === "jpg" ? "jpg" : ext}`;
  return saveImageToLocal(sourceUrl, "volc-assets", safeName);
}

/** 从 fileStorage 加载素材（按 groupId） */
async function loadAssetsByGroup(groupId: string): Promise<VolcAssetItem[]> {
  try {
    const fs = (window as any).fileStorage;
    if (!fs) return loadAssetLibraryFallback();
    const raw = await fs.getItem(getGroupAssetsKey(groupId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** 保存素材到 fileStorage（按 groupId） */
async function saveAssetsByGroup(groupId: string, items: VolcAssetItem[]): Promise<void> {
  try {
    const fs = (window as any).fileStorage;
    if (!fs) {
      // 降级到 localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      return;
    }
    await fs.setItem(getGroupAssetsKey(groupId), JSON.stringify(items));
  } catch (err) {
    console.error("[VolcAssetPanel] 保存素材失败:", err);
  }
}

/** localStorage 降级读取（兼容旧数据迁移） */
function loadAssetLibraryFallback(): VolcAssetItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** 从 fileStorage 加载 group 信息 */
async function loadStoredGroupAsync(): Promise<StoredGroup | null> {
  try {
    const fs = (window as any).fileStorage;
    if (!fs) {
      const raw = localStorage.getItem(GROUP_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }
    const raw = await fs.getItem(GROUP_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 保存 group 信息到 fileStorage */
async function saveStoredGroupAsync(group: StoredGroup | null): Promise<void> {
  try {
    const fs = (window as any).fileStorage;
    if (!fs) {
      if (group) localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(group));
      else localStorage.removeItem(GROUP_STORAGE_KEY);
      return;
    }
    if (group) {
      await fs.setItem(GROUP_STORAGE_KEY, JSON.stringify(group));
    } else {
      await fs.removeItem(GROUP_STORAGE_KEY);
    }
  } catch (err) {
    console.error("[VolcAssetPanel] 保存 group 失败:", err);
  }
}

// ==================== 组件 ====================

export function VolcAssetPanel({
  open,
  onOpenChange,
  onSelectAsset,
  selectedAssetIds = [],
}: VolcAssetPanelProps) {
  const [assets, setAssets] = useState<VolcAssetItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [isConfigured, setIsConfigured] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingAssets, setLoadingAssets] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Group 状态
  const [group, setGroup] = useState<StoredGroup | null>(null);
  const [copiedGroupId, setCopiedGroupId] = useState(false);

  // 初始化：从 fileStorage 加载 group 信息
  useEffect(() => {
    if (!open) return;
    loadStoredGroupAsync().then((g) => {
      setGroup(g);
    });
  }, [open]);

  // 当 group 变化时，从 fileStorage 加载该组的素材
  useEffect(() => {
    if (!group) {
      // 无关联组时尝试加载旧 localStorage 数据（兼容迁移）
      const fallback = loadAssetLibraryFallback();
      setAssets(fallback);
      return;
    }
    setLoadingAssets(true);
    loadAssetsByGroup(group.groupId).then((items) => {
      // 如果 fileStorage 为空但 localStorage 有旧数据，自动迁移
      if (items.length === 0) {
        const fallback = loadAssetLibraryFallback();
        const groupItems = fallback.filter((a) => a.groupId === group.groupId);
        if (groupItems.length > 0) {
          setAssets(groupItems);
          // 异步迁移保存
          void saveAssetsByGroup(group.groupId, groupItems);
        } else {
          setAssets(fallback.length > 0 ? fallback : []);
        }
      } else {
        setAssets(items);
      }
      setLoadingAssets(false);

      const currentItems = items.length > 0 ? items : loadAssetLibraryFallback();
      const remoteThumbs = currentItems.filter((item) => item.url && !isPersistentThumbnail(item.url));
      if (remoteThumbs.length > 0) {
        void Promise.all(
          remoteThumbs.map(async (item) => {
            const localUrl = await saveAssetThumbnailLocally(item.url, item.name);
            return localUrl !== item.url ? { ...item, url: localUrl } : item;
          }),
        ).then((migrated) => {
          setAssets((prev) => {
            const migratedMap = new Map(migrated.map((item) => [item.assetId, item]));
            const next = prev.map((item) => migratedMap.get(item.assetId) || item);
            void saveAssetsByGroup(group.groupId, next);
            return next;
          });
        });
      }
    });
  }, [group]);

  // 检查配置
  useEffect(() => {
    if (!open) return;
    if (!window.volcAsset) {
      setIsConfigured(false);
      return;
    }
    window.volcAsset
      .isConfigured()
      .then(setIsConfigured)
      .catch(() => setIsConfigured(false));
  }, [open]);

  // 素材变化时持久化保存（按 group）
  useEffect(() => {
    if (!group) return;
    void saveAssetsByGroup(group.groupId, assets);
  }, [assets, group]);

  // 复制 GroupId
  const handleCopyGroupId = useCallback(() => {
    if (!group) return;
    navigator.clipboard.writeText(group.groupId).then(() => {
      setCopiedGroupId(true);
      toast.success("GroupId 已复制");
      setTimeout(() => setCopiedGroupId(false), 2000);
    });
  }, [group]);

  // 上传图片
  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!window.volcAsset) {
        toast.error("当前环境不支持火山引擎素材上传（需要桌面端）");
        return;
      }
      if (!group) {
        toast.error("请先创建或关联一个素材组");
        return;
      }

      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) {
        toast.error("请选择图片文件");
        return;
      }
      const oversized = imageFiles.filter((f) => f.size > 30 * 1024 * 1024);
      if (oversized.length > 0) {
        toast.error(`${oversized.length} 个文件超过 30MB 限制`);
        return;
      }

      setUploading(true);
      setUploadProgress("准备上传...");

      try {
        const { uploadBase64Image } = await import(
          "@/lib/utils/image-upload"
        );
        const results: VolcAssetItem[] = [];

        for (let i = 0; i < imageFiles.length; i++) {
          const file = imageFiles[i];
          setUploadProgress(
            `(${i + 1}/${imageFiles.length}) ${file.name}：读取文件...`,
          );

          try {
            // 1. 读取 base64
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ""));
              reader.onerror = () => reject(new Error("文件读取失败"));
              reader.readAsDataURL(file);
            });

            // 2. 缩略图先保存到本地。素材管理面板不再依赖火山返回的临时/远程 URL 展示。
            const localThumbnailUrl = await saveAssetThumbnailLocally(dataUrl, file.name);

            // 3. 上传图床获取公网 URL，供火山 CreateAsset 使用
            setUploadProgress(
              `(${i + 1}/${imageFiles.length}) ${file.name}：上传到图床...`,
            );
            const publicUrl = await uploadBase64Image(dataUrl);

            // 4. 提交到火山引擎素材资产库。
            // 这里仅创建资产，不逐张轮询 GetAsset，避免多图上传时密集触发 GetAsset 导致 429。
            setUploadProgress(
              `(${i + 1}/${imageFiles.length}) ${file.name}：提交到素材库...`,
            );
            const result = await window.volcAsset!.createAsset({
              imageUrl: publicUrl,
              groupId: group.groupId,
              name: file.name,
            });

            results.push({
              assetId: result.assetId,
              assetUri: `Asset://${result.assetId}`,
              url: localThumbnailUrl,
              name: file.name,
              groupId: group.groupId,
              groupName: group.groupName,
              uploadedAt: Date.now(),
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            toast.error(`上传 ${file.name} 失败: ${msg}`);
          }
        }

        if (results.length > 0) {
          setAssets((prev) => [...results, ...prev]);
          toast.success(`成功上传 ${results.length} 个素材`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`上传失败: ${msg}`);
      } finally {
        setUploading(false);
        setUploadProgress("");
      }
    },
    [group],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = "";
      if (files.length > 0) void handleUploadFiles(files);
    },
    [handleUploadFiles],
  );

  const removeAsset = useCallback((assetId: string) => {
    setAssets((prev) => prev.filter((a) => a.assetId !== assetId));
  }, []);

  // 过滤搜索
  const filteredAssets = searchQuery.trim()
    ? assets.filter((a) =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : assets;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            素材资产管理
          </DialogTitle>
          <DialogDescription>
            管理火山引擎方舟素材库，点击素材即可导入到参考列表
          </DialogDescription>
        </DialogHeader>

        {/* 未配置提示 */}
        {!isConfigured ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <FolderOpen className="h-12 w-12 opacity-30" />
            <p className="text-sm font-medium">未配置火山引擎 AK/SK</p>
            <p className="text-xs">
              请先在「设置 → 图床配置 → 虚拟人像素材」中完成配置
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 min-h-0 flex-1">
            {/* ===== 素材组信息 ===== */}
            {group ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg border text-sm">
                <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium truncate">{group.groupName}</span>
                <span className="text-muted-foreground text-xs shrink-0">
                  ·
                </span>
                <code className="text-xs text-muted-foreground font-mono truncate">
                  {group.groupId}
                </code>
                <button
                  type="button"
                  onClick={handleCopyGroupId}
                  className="ml-auto shrink-0 p-1 rounded hover:bg-muted transition-colors"
                  title="复制 GroupId"
                >
                  {copiedGroupId ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGroup(null);
                    void saveStoredGroupAsync(null);
                  }}
                  className="shrink-0 p-1 rounded hover:bg-destructive/10 transition-colors"
                  title="断开关联"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                <p className="text-xs text-muted-foreground">
                  请输入已有的 GroupId 进行关联。如需创建素材组，请前往「设置 → 图床配置 → 虚拟人像素材」。
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="输入 GroupId 进行关联"
                    className="h-8 text-sm flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val) {
                          const g: StoredGroup = {
                            groupId: val,
                            groupName: "已关联组",
                          };
                          setGroup(g);
                          void saveStoredGroupAsync(g);
                          toast.success("已关联素材组");
                        }
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0"
                    onClick={() => {
                      const input = document.querySelector<HTMLInputElement>(
                        '[placeholder="输入 GroupId 进行关联"]',
                      );
                      const val = input?.value.trim();
                      if (val) {
                        const g: StoredGroup = {
                          groupId: val,
                          groupName: "已关联组",
                        };
                        setGroup(g);
                        void saveStoredGroupAsync(g);
                        toast.success("已关联素材组");
                      } else {
                        toast.error("请输入 GroupId");
                      }
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    关联
                  </Button>
                </div>
              </div>
            )}

            {/* ===== 搜索栏 ===== */}
            {assets.length > 0 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索素材名称..."
                  className="h-8 text-sm pl-8"
                />
              </div>
            )}

            {/* ===== 图库网格 ===== */}
            {loadingAssets ? (
              <div className="flex-1 flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">加载素材中…</span>
              </div>
            ) : (
            <ScrollArea className="flex-1 min-h-0">
              <div className="grid grid-cols-5 gap-2 pb-2">
                {/* 第一格：上传按钮 */}
                {group && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    title={`上传图片要求：\n宽高比:0.4-2.5\n单边像素限制:300-6000px\n图像大小:≤30MB\n按住Ctrl可多选图片进行上传(也可直接拖入图片上传)。`}
                    className="aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-50"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const files = e.dataTransfer.files
                        ? Array.from(e.dataTransfer.files)
                        : [];
                      if (files.length > 0) void handleUploadFiles(files);
                    }}
                  >
                    {uploading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <Upload className="h-6 w-6" />
                    )}
                    <span className="text-[11px] font-medium">
                      {uploading ? "上传中" : "上传图片"}
                    </span>
                  </button>
                )}

                {/* 素材缩略图 */}
                {filteredAssets.map((asset) => {
                  const isSelected = selectedAssetIds.includes(asset.assetId);
                  return (
                    <div
                      key={asset.assetId}
                      className={`relative aspect-square rounded-lg border overflow-hidden cursor-pointer group/asset transition-all ${
                        isSelected
                          ? "border-primary ring-2 ring-primary/40 shadow-sm"
                          : "border-border hover:border-primary/40 hover:shadow-sm"
                      }`}
                      onClick={() => onSelectAsset(asset)}
                      title={`${asset.name}\nAsset: ${asset.assetUri}\n点击导入到参考素材`}
                    >
                      <AssetThumbnail asset={asset} />
                      {/* 选中角标 */}
                      {isSelected && (
                        <div className="absolute top-1 left-1 bg-primary text-primary-foreground rounded-full p-0.5 shadow">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                      {/* 悬停蒙版 + 操作 */}
                      <div className="absolute inset-0 bg-black/0 group-hover/asset:bg-black/40 transition-colors flex items-end">
                        <div className="w-full px-1.5 pb-1.5 opacity-0 group-hover/asset:opacity-100 transition-opacity">
                          <p className="text-[10px] text-white truncate leading-tight">
                            {asset.name}
                          </p>
                          <p className="text-[9px] text-white/70 truncate leading-tight">
                            {new Date(asset.uploadedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      {/* 删除按钮 */}
                      <button
                        type="button"
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover/asset:opacity-100 transition-opacity hover:bg-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAsset(asset.assetId);
                        }}
                        title="从本地库中移除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* 空状态 */}
              {filteredAssets.length === 0 && group && !uploading && (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                  <FolderOpen className="h-10 w-10 opacity-30" />
                  <p className="text-sm">
                    {searchQuery ? "没有匹配的素材" : "暂无素材"}
                  </p>
                  <p className="text-xs">
                    {searchQuery
                      ? "尝试其他搜索词"
                      : "点击左上角上传图片到素材库"}
                  </p>
                </div>
              )}
            </ScrollArea>
            )}

            {/* 上传进度 */}
            {uploading && uploadProgress && (
              <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 rounded-md border">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  {uploadProgress}
                </span>
              </div>
            )}

            {/* 底部统计 */}
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
              <span>
                共 {assets.length} 个素材
                {selectedAssetIds.length > 0 &&
                  ` · 已选 ${selectedAssetIds.length} 个`}
              </span>
              <span>点击素材导入，使用 Asset ID 直传</span>
            </div>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/bmp,image/tiff,image/gif"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </DialogContent>
    </Dialog>
  );
}
