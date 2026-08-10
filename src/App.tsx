// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { Toaster } from "@/components/ui/sonner";
import { UpdateDialog } from "@/components/UpdateDialog";
import { useThemeStore } from "@/stores/theme-store";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { parseApiKeys } from "@/lib/api-key-manager";
import { Loader2 } from "lucide-react";
import { migrateToProjectStorage, recoverFromLegacy } from "@/lib/storage-migration";
import { recoverAllPendingVideoTasks, isVideoStudioMounted } from "@/lib/freedom/video-task-recovery";
import { useFreedomTaskStore } from "@/stores/freedom-task-store";
import { useProjectStore } from "@/stores/project-store";
import { useBlueprintStore } from "@/stores/blueprint-store";
import type { AvailableUpdateInfo } from "@/types/update";

let hasTriggeredStartupUpdateCheck = false;
let hasTriggeredStartupTaskRecovery = false;
let hasTriggeredBlueprintTaskRecovery = false;

function App() {
  const { theme } = useThemeStore();
  const { updateSettings, setUpdateSettings } = useAppSettingsStore();
  const [isMigrating, setIsMigrating] = useState(true);
  const [startupUpdate, setStartupUpdate] = useState<AvailableUpdateInfo | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

  // 启动时运行存储迁移 + 数据恢复
  useEffect(() => {
    (async () => {
      try {
        await useAppSettingsStore.persist.rehydrate();
        await migrateToProjectStorage();
        await recoverFromLegacy();
      } catch (err) {
        console.error('[App] Migration/recovery error:', err);
      } finally {
        setIsMigrating(false);
      }
    })();
  }, []);

  // 启动时自动同步所有已配置 API Key 的供应商模型元数据
  useEffect(() => {
    if (isMigrating) return;
    let cancelled = false;

    const runStartupSync = async () => {
      const { providers, syncProviderModels } = useAPIConfigStore.getState();
      const configuredProviders = providers
        .filter((p) => parseApiKeys(p.apiKey).length > 0)
        .sort((a, b) => Number(b.platform === 'memefast') - Number(a.platform === 'memefast'));

      for (const p of configuredProviders) {
        if (cancelled) return;
        try {
          const result = await syncProviderModels(p.id);
          if (cancelled) return;
          if (result.success) {
            console.log(`[App] Auto-synced ${p.name}: ${result.count} models`);
          } else {
            console.warn(`[App] Auto-sync skipped for ${p.name}: ${result.error || 'unknown error'}`);
          }
        } catch (error) {
          if (!cancelled) {
            console.warn(`[App] Auto-sync failed for ${p.name}:`, error);
          }
        }
      }
    };

    void runStartupSync();

    return () => {
      cancelled = true;
    };
  }, [isMigrating]);

  // 启动时接续上次未完成的视频任务（断网/退出应用导致查询链断开的场景）。
  // 不依赖用户是否打开「自由 → 视频」标签页：上游已扣费的结果必须能被领回。
  useEffect(() => {
    if (isMigrating || hasTriggeredStartupTaskRecovery) return;
    hasTriggeredStartupTaskRecovery = true;

    let cancelled = false;
    (async () => {
      // 任务队列走 fileStorage 异步持久化，需先等 rehydrate 完成再读
      await useFreedomTaskStore.persist.rehydrate();
      if (cancelled) return;
      const started = recoverAllPendingVideoTasks();
      if (started > 0) {
        console.log(`[App] Resumed ${started} pending video task(s)`);
      }
    })().catch((error) => {
      console.warn("[App] Video task recovery failed:", error);
    });

    return () => {
      cancelled = true;
    };
  }, [isMigrating]);

  // 网络恢复时兜底再扫一遍。
  // 若 VideoStudio 正挂载，交由它自己处理（它能同步刷新任务卡片 UI），此处不抢。
  useEffect(() => {
    const handleOnline = () => {
      if (isVideoStudioMounted()) return;
      recoverAllPendingVideoTasks();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  // 启动时接续蓝图画布中未完成的视频生成任务（P1-2）。
  // 蓝图数据按项目路由（createProjectScopedStorage），需先等 project/blueprint store
  // rehydrate 完成、activeProjectId 就绪后才能定位到对应项目的视频生成节点。
  useEffect(() => {
    if (isMigrating || hasTriggeredBlueprintTaskRecovery) return;
    hasTriggeredBlueprintTaskRecovery = true;

    let cancelled = false;
    (async () => {
      await useProjectStore.persist.rehydrate();
      if (cancelled) return;
      await useBlueprintStore.persist.rehydrate();
      if (cancelled) return;
      const recovered = await useBlueprintStore.getState().recoverVideoTasks();
      if (recovered) {
        console.log("[App] Resumed blueprint video task(s)");
      }
    })().catch((error) => {
      console.warn("[App] Blueprint video task recovery failed:", error);
    });

    return () => {
      cancelled = true;
    };
  }, [isMigrating]);

  // 网络恢复时再兜底扫一遍蓝图中的视频任务
  useEffect(() => {
    const handleOnline = () => {
      void useBlueprintStore.getState().recoverVideoTasks();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  // 同步主题到 html 元素
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    if (
      isMigrating ||
      hasTriggeredStartupUpdateCheck ||
      !updateSettings.autoCheckEnabled ||
      !window.appUpdater
    ) {
      return;
    }

    hasTriggeredStartupUpdateCheck = true;
    let cancelled = false;

    (async () => {
      const result = await window.appUpdater?.checkForUpdates();
      if (
        cancelled ||
        !result ||
        !result.success ||
        !result.hasUpdate ||
        !result.update ||
        result.update.latestVersion === updateSettings.ignoredVersion
      ) {
        return;
      }

      setStartupUpdate(result.update);
      setUpdateDialogOpen(true);
    })().catch((error) => {
      console.warn("[App] Auto update check failed:", error);
    });

    return () => {
      cancelled = true;
    };
  }, [isMigrating, updateSettings.autoCheckEnabled, updateSettings.ignoredVersion]);

  // 迁移中显示加载界面
  if (isMigrating) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">正在初始化...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden">
      <Layout />
      <UpdateDialog
        open={updateDialogOpen}
        onOpenChange={setUpdateDialogOpen}
        updateInfo={startupUpdate}
        onIgnoreVersion={(version) => {
          setUpdateSettings({ ignoredVersion: version });
          setStartupUpdate(null);
        }}
      />
      <Toaster richColors position="top-center" />
    </div>
  );
}

export default App;
