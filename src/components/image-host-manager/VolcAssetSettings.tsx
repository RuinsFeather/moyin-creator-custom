// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
//
// 火山引擎方舟素材资产配置面板
// 使用 AK/SK 鉴权将素材上传至私域虚拟人像项目（youdianchuangyi）

import { useEffect, useState, useCallback } from "react";
import { Info, Loader2, Eye, EyeOff, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FormState {
  accessKeyId: string;
  secretAccessKey: string;
  projectName: string;
  groupName: string;
}

const DEFAULT_FORM: FormState = {
  accessKeyId: "",
  secretAccessKey: "",
  projectName: "youdianchuangyi",
  groupName: "",
};

export function VolcAssetSettings() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [secretIsMasked, setSecretIsMasked] = useState(false);
  const [groupId, setGroupId] = useState<string>("");
  const [copiedGroupId, setCopiedGroupId] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.volcAsset) return;
    setLoading(true);
    try {
      const cfg = await window.volcAsset.getConfig();
      if (cfg) {
        setForm((prev) => ({
          ...prev,
          accessKeyId: cfg.accessKeyId || "",
          secretAccessKey: cfg.secretAccessKey || "",
          projectName: cfg.projectName || "youdianchuangyi",
        }));
        setSecretIsMasked(
          !!cfg.secretAccessKey && /^\*+$/.test(cfg.secretAccessKey),
        );
        setHasConfig(true);
      } else {
        setHasConfig(false);
      }
    } catch (err) {
      console.error("[VolcAssetSettings] load failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    if (patch.secretAccessKey !== undefined) setSecretIsMasked(false);
  };

  const handleSave = async () => {
    if (!window.volcAsset) {
      toast.error("当前环境不支持火山引擎素材上传（需要桌面端）");
      return;
    }
    if (!form.accessKeyId || !form.secretAccessKey) {
      toast.error("Access Key ID 和 Secret Access Key 不能为空");
      return;
    }
    setLoading(true);
    try {
      await window.volcAsset.saveConfig({
        accessKeyId: form.accessKeyId.trim(),
        secretAccessKey: form.secretAccessKey,
        projectName: form.projectName.trim() || "youdianchuangyi",
      });
      toast.success("火山引擎 AK/SK 配置已保存");
      await refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`保存失败：${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!window.volcAsset) {
      toast.error("当前环境不支持火山引擎素材上传（需要桌面端）");
      return;
    }
    if (!form.groupName.trim()) {
      toast.error("请输入素材组名称");
      return;
    }
    // 确保先保存了 AK/SK
    const isConfigured = await window.volcAsset.isConfigured();
    if (!isConfigured) {
      toast.error("请先保存 AK/SK 配置");
      return;
    }
    setCreatingGroup(true);
    try {
      const result = await window.volcAsset.createGroup({
        name: form.groupName.trim(),
        projectName: form.projectName.trim() || "youdianchuangyi",
      });
      setGroupId(result.groupId);
      toast.success(`素材组创建成功！GroupId: ${result.groupId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`创建素材组失败：${msg}`);
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleCopyGroupId = () => {
    if (!groupId) return;
    navigator.clipboard.writeText(groupId).then(() => {
      setCopiedGroupId(true);
      toast.success("GroupId 已复制到剪贴板");
      setTimeout(() => setCopiedGroupId(false), 2000);
    });
  };

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="flex items-start gap-3 p-4 bg-muted/50 border border-border rounded-lg">
        <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            火山引擎<strong>方舟素材资产库</strong>用于上传私域虚拟人像素材。
            需使用 Access Key (AK/SK) 进行 V4 签名鉴权，素材会绑定到指定项目。
          </p>
          <p>
            流程：创建素材组 → 上传图片 → 轮询处理完成 → 获取{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              Asset://&lt;AssetId&gt;
            </code>{" "}
            URI 用于视频生成。
          </p>
        </div>
      </div>

      {/* AK/SK 配置 */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium">鉴权配置</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">Access Key ID *</Label>
            <Input
              value={form.accessKeyId}
              onChange={(e) => update({ accessKeyId: e.target.value })}
              placeholder="AKLTxxxxxxxx"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Secret Access Key *</Label>
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
                value={form.secretAccessKey}
                onChange={(e) =>
                  update({ secretAccessKey: e.target.value })
                }
                placeholder={
                  secretIsMasked ? "已保存，留空保留原值" : "输入密钥"
                }
                autoComplete="new-password"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowSecret((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSecret ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {secretIsMasked && (
              <p className="text-xs text-muted-foreground">
                已保存（密钥已加密存储）。如需修改请清空后重新输入。
              </p>
            )}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label className="text-sm">ProjectName *</Label>
            <Input
              value={form.projectName}
              onChange={(e) => update({ projectName: e.target.value })}
              placeholder="youdianchuangyi"
            />
            <p className="text-xs text-muted-foreground">
              素材所属项目名称。所有请求（创建组、上传、查询）必须使用同一项目名，否则视频生成 API 将无法使用素材。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : null}
            保存配置
          </Button>
          {hasConfig && (
            <span className="self-center text-xs px-2 py-0.5 bg-green-500/10 text-green-500 rounded">
              已配置
            </span>
          )}
        </div>
      </div>

      {/* 分割线 */}
      <div className="border-t border-border" />

      {/* 创建素材组 */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium">创建素材组</h4>
        <p className="text-xs text-muted-foreground">
          素材组（Asset Group）用于管理同一项目或人物的素材，上传素材前需要先创建或选择一个素材组。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">素材组名称 *</Label>
            <Input
              value={form.groupName}
              onChange={(e) => update({ groupName: e.target.value })}
              placeholder="例如：角色素材组"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleCreateGroup}
              disabled={creatingGroup || !hasConfig}
              variant="outline"
            >
              {creatingGroup ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              创建素材组
            </Button>
          </div>
        </div>

        {/* GroupId 显示 */}
        {groupId && (
          <div className="p-4 border border-green-500/30 bg-green-500/5 rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              <span className="text-sm font-medium text-green-600 dark:text-green-400">
                素材组创建成功
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground shrink-0">
                GroupId:
              </Label>
              <code className="text-xs bg-muted px-2 py-1 rounded font-mono flex-1 break-all select-all">
                {groupId}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCopyGroupId}
                className="shrink-0 h-7 w-7 p-0"
              >
                {copiedGroupId ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              请记录此 GroupId，后续上传素材时可复用该素材组，无需重复创建。
            </p>
          </div>
        )}

        {!hasConfig && (
          <p className="text-xs text-amber-500">
            请先保存 AK/SK 配置后才能创建素材组。
          </p>
        )}
      </div>

      {/* 使用说明 */}
      <div className="flex items-start gap-3 p-4 bg-muted/50 border border-border rounded-lg">
        <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="space-y-2 text-xs text-muted-foreground">
          <p className="font-medium text-sm">素材要求</p>
          <ul className="list-disc list-inside space-y-1">
            <li>格式：jpeg、png、webp、bmp、tiff、gif、heic/heif</li>
            <li>宽高比（宽/高）：0.4 ~ 2.5</li>
            <li>宽高：300px ~ 6000px</li>
            <li>大小：单张 ≤ 30 MB</li>
            <li>合规性：不含未授权的商标、肖像或违规内容</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
