// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
//
// 对象存储（S3 兼容）配置面板：用于视频/音频等大文件上传
// 支持 Cloudflare R2 / AWS S3 / MinIO / 阿里云 OSS（S3 网关）/ 腾讯云 COS（S3 网关）

import { useEffect, useState, useCallback } from "react";
import { Cloud, Loader2, Info, Eye, EyeOff, Trash2, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FormState {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBase: string;
  forcePathStyle: boolean;
  autoCleanEnabled: boolean;
  retentionDays: number;
  maxStorageGB: number;
}

const DEFAULT_FORM: FormState = {
  endpoint: "",
  region: "auto",
  bucket: "",
  accessKeyId: "",
  secretAccessKey: "",
  publicBase: "",
  forcePathStyle: true,
  autoCleanEnabled: true,
  retentionDays: 3,
  maxStorageGB: 8,
};

interface UsageInfo {
  totalBytes: number;
  totalCount: number;
  oldest: number | null;
  newest: number | null;
  maxStorageBytes: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ObjectStorageSettings() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [secretIsMasked, setSecretIsMasked] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.objectStorage) return;
    setLoading(true);
    try {
      const cfg = await window.objectStorage.getConfig();
      if (cfg) {
        setForm({
          endpoint: cfg.endpoint || "",
          region: cfg.region || "auto",
          bucket: cfg.bucket || "",
          accessKeyId: cfg.accessKeyId || "",
          secretAccessKey: cfg.secretAccessKey || "",
          publicBase: cfg.publicBase || "",
          forcePathStyle: cfg.forcePathStyle ?? true,
          autoCleanEnabled: cfg.autoCleanEnabled ?? true,
          retentionDays: cfg.retentionDays ?? 3,
          maxStorageGB: cfg.maxStorageBytes
            ? Math.round((cfg.maxStorageBytes / 1024 / 1024 / 1024) * 10) / 10
            : 8,
        });
        setSecretIsMasked(!!cfg.secretAccessKey && /^\*+$/.test(cfg.secretAccessKey));
        setHasConfig(true);
      } else {
        setHasConfig(false);
      }
    } catch (err) {
      console.error("[ObjectStorageSettings] load failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshUsage = useCallback(async () => {
    if (!window.objectStorage?.getUsage) return;
    setUsageLoading(true);
    try {
      const u = await window.objectStorage.getUsage();
      setUsage(u);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`获取用量失败：${msg}`);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (hasConfig) void refreshUsage();
  }, [hasConfig, refreshUsage]);

  const update = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    if (patch.secretAccessKey !== undefined) setSecretIsMasked(false);
  };

  const handleSave = async () => {
    if (!window.objectStorage) {
      toast.error("当前环境不支持对象存储（需要桌面端）");
      return;
    }
    if (!form.endpoint || !form.bucket || !form.accessKeyId || !form.secretAccessKey) {
      toast.error("Endpoint / Bucket / Access Key ID / Secret Access Key 均为必填");
      return;
    }
    setLoading(true);
    try {
      await window.objectStorage.saveConfig({
        endpoint: form.endpoint.trim(),
        region: form.region.trim() || "auto",
        bucket: form.bucket.trim(),
        accessKeyId: form.accessKeyId.trim(),
        secretAccessKey: form.secretAccessKey,
        publicBase: form.publicBase.trim() || undefined,
        forcePathStyle: form.forcePathStyle,
        autoCleanEnabled: form.autoCleanEnabled,
        retentionDays: Math.max(1, Math.min(30, Math.floor(form.retentionDays))),
        maxStorageBytes: Math.max(1, form.maxStorageGB) * 1024 * 1024 * 1024,
      });
      toast.success("对象存储配置已保存");
      await refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`保存失败：${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!window.objectStorage) return;
    if (!form.endpoint || !form.bucket || !form.accessKeyId || !form.secretAccessKey) {
      toast.error("请先填写完整配置");
      return;
    }
    setTesting(true);
    try {
      await window.objectStorage.test({
        endpoint: form.endpoint.trim(),
        region: form.region.trim() || "auto",
        bucket: form.bucket.trim(),
        accessKeyId: form.accessKeyId.trim(),
        secretAccessKey: form.secretAccessKey,
        forcePathStyle: form.forcePathStyle,
      });
      toast.success("连接成功，Bucket 可访问 ✓");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`连接失败：${msg}`);
    } finally {
      setTesting(false);
    }
  };

  const handleCleanup = async (deleteAll: boolean) => {
    if (!window.objectStorage?.cleanup) return;
    if (deleteAll) {
      const ok = window.confirm(
        "确认清空对象存储中所有由本应用上传的文件？此操作不可恢复。",
      );
      if (!ok) return;
    }
    setCleaning(true);
    try {
      const r = await window.objectStorage.cleanup(
        deleteAll
          ? { deleteAll: true }
          : { retentionDays: Math.max(0, Math.floor(form.retentionDays)) },
      );
      toast.success(
        `清理完成：删除 ${r.deletedCount} 个文件（${formatBytes(r.deletedBytes)}）`,
      );
      await refreshUsage();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`清理失败：${msg}`);
    } finally {
      setCleaning(false);
    }
  };

  const usagePct = usage
    ? Math.min(100, (usage.totalBytes / usage.maxStorageBytes) * 100)
    : 0;
  const usageColor =
    usagePct < 60 ? "bg-green-500" : usagePct < 85 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-4 bg-muted/50 border border-border rounded-lg">
        <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            视频 / 音频参考素材通过 <strong>S3 兼容协议</strong>{" "}
            上传到您自己的对象存储（推荐 Cloudflare R2 免费 10GB），主进程流式上传后生成 Presigned URL 提交给 AI 服务。
          </p>
          <p>视频文件大小上限 1GB，音频文件大小上限 200MB。图片仍走原图床。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-sm">Endpoint *</Label>
          <Input
            value={form.endpoint}
            onChange={(e) => update({ endpoint: e.target.value })}
            placeholder="https://<account>.r2.cloudflarestorage.com"
          />
          <p className="text-xs text-muted-foreground">
            R2: <code>https://&lt;accountId&gt;.r2.cloudflarestorage.com</code> · S3: <code>https://s3.&lt;region&gt;.amazonaws.com</code> · MinIO: 自建域名
          </p>
        </div>
        <div className="space-y-2">
          <Label className="text-sm">Region *</Label>
          <Input
            value={form.region}
            onChange={(e) => update({ region: e.target.value })}
            placeholder="auto / us-east-1 / ap-southeast-1"
          />
          <p className="text-xs text-muted-foreground">R2 填 <code>auto</code></p>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label className="text-sm">Bucket *</Label>
          <Input
            value={form.bucket}
            onChange={(e) => update({ bucket: e.target.value })}
            placeholder="my-moyin-assets"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm">Access Key ID *</Label>
          <Input
            value={form.accessKeyId}
            onChange={(e) => update({ accessKeyId: e.target.value })}
            placeholder="AKIA..."
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm">Secret Access Key *</Label>
          <div className="relative">
            <Input
              type={showSecret ? "text" : "password"}
              value={form.secretAccessKey}
              onChange={(e) => update({ secretAccessKey: e.target.value })}
              placeholder={secretIsMasked ? "已保存，留空保留原值" : "输入密钥"}
              autoComplete="new-password"
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setShowSecret((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {secretIsMasked && (
            <p className="text-xs text-muted-foreground">
              已保存（密钥已加密存储，本机可解密）。如需修改请清空后重新输入。
            </p>
          )}
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label className="text-sm">Public Base URL（可选）</Label>
          <Input
            value={form.publicBase}
            onChange={(e) => update({ publicBase: e.target.value })}
            placeholder="https://assets.example.com"
          />
          <p className="text-xs text-muted-foreground">
            若 Bucket 已绑定自定义域名（如 R2 公开 bucket / CDN），填写后将返回直链而非 Presigned URL。
          </p>
        </div>
        <div className="md:col-span-2 flex items-center gap-2">
          <input
            type="checkbox"
            id="forcePathStyle"
            checked={form.forcePathStyle}
            onChange={(e) => update({ forcePathStyle: e.target.checked })}
            className="h-4 w-4 rounded border-border"
          />
          <Label htmlFor="forcePathStyle" className="text-sm cursor-pointer">
            使用 Path-Style 寻址（MinIO 必须勾选；R2 / S3 默认勾选也兼容）
          </Label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Cloud className="h-4 w-4 mr-1" />}
          保存配置
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={testing}>
          {testing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
          测试连接
        </Button>
        {hasConfig && (
          <span className="self-center text-xs px-2 py-0.5 bg-green-500/10 text-green-500 rounded">
            已配置
          </span>
        )}
      </div>

      {hasConfig && (
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">存储用量与清理</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={refreshUsage}
              disabled={usageLoading}
            >
              {usageLoading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
              )}
              刷新
            </Button>
          </div>

          {usage ? (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between text-sm">
                <span>
                  <strong className="text-base">{usage.totalCount}</strong> 个文件 ·{" "}
                  <strong className="text-base">{formatBytes(usage.totalBytes)}</strong>{" "}
                  / {formatBytes(usage.maxStorageBytes)}
                </span>
                <span
                  className={
                    usagePct >= 85
                      ? "text-red-500"
                      : usagePct >= 60
                      ? "text-yellow-500"
                      : "text-muted-foreground"
                  }
                >
                  {usagePct.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 w-full bg-muted rounded overflow-hidden">
                <div
                  className={`h-full ${usageColor} transition-all`}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>最早：{formatDate(usage.oldest)}</div>
                <div>最新：{formatDate(usage.newest)}</div>
              </div>

              {usagePct >= 85 && (
                <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-500">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>用量已接近阈值，建议立即清理或调高阈值。</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">点击"刷新"以查看当前用量</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label className="text-xs">保留天数（自动清理超过此天数的文件）</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={form.retentionDays}
                onChange={(e) => update({ retentionDays: Number(e.target.value) || 3 })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">容量阈值（GB，超过则从旧到新继续删）</Label>
              <Input
                type="number"
                min={1}
                max={100}
                step={0.5}
                value={form.maxStorageGB}
                onChange={(e) => update({ maxStorageGB: Number(e.target.value) || 8 })}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={form.autoCleanEnabled}
                  onChange={(e) => update({ autoCleanEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                启动时 + 每 24 小时自动清理
              </label>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            修改清理设置后请点击上方"保存配置"使其生效。Cloudflare R2 免费配额为 10GB，建议保持默认 3 天 / 8GB。
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCleanup(false)}
              disabled={cleaning}
            >
              {cleaning ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1" />
              )}
              立即清理 {form.retentionDays} 天前的文件
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleCleanup(true)}
              disabled={cleaning}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              清空全部上传文件
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
