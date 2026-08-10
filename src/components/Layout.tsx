// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { TabBar } from "./TabBar";
import { PreviewPanel } from "./PreviewPanel";
import { RightPanel } from "./RightPanel";
import { Dashboard } from "./Dashboard";
import { ProjectHeader } from "./ProjectHeader";
import { useMediaPanelStore, resolveTab } from "@/stores/media-panel-store";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

// Four-module panel imports
import { ScriptView } from "@/components/panels/script";
import { SettingsPanel } from "@/components/panels/SettingsPanel";
import { StoryboardPanel } from "@/components/panels/storyboard";
import { DebugPanel } from "@/components/panels/DebugPanel";
import { BlueprintView } from "@/components/blueprint/BlueprintView";
import { ScriptWorkspace } from "@/components/script-workspace";
import { FreedomView } from "@/components/panels/freedom";

export function Layout() {
  const { activeTab: rawTab, inProject } = useMediaPanelStore();
  // Resolve legacy tabs to their new module
  const activeTab = resolveTab(rawTab);

  // Dashboard mode - show full-screen dashboard or settings
  if (!inProject) {
    return (
      <div className="h-full flex bg-background">
        <TabBar />
        <div className="flex-1">
          {activeTab === "settings" ? <SettingsPanel /> : activeTab === "debug" ? <DebugPanel /> : <Dashboard />}
        </div>
      </div>
    );
  }

  // Full-screen views (no resizable panels)
  // 这些板块有自己的多栏布局，不需要全局的预览和属性面板
  const fullScreenTabs: string[] = ["settings", "script", "storyboard", "debug", "blueprint", "freedom"];
  if (fullScreenTabs.includes(activeTab)) {
    return (
      <div className="h-full flex bg-background">
        <TabBar />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <ProjectHeader />
          {activeTab === "settings" && <SettingsPanel />}
          {activeTab === "script" && <ScriptWorkspace />}
          {activeTab === "storyboard" && <StoryboardPanel />}
          {activeTab === "debug" && <DebugPanel />}
          {activeTab === "blueprint" && <BlueprintView />}
          {activeTab === "freedom" && <FreedomView />}
        </div>
      </div>
    );
  }

  // Left panel content based on active tab
  // 注：旧 tab（characters/scenes/director/sclass/media/export/assets/project-assets/overview）
  // 已由 resolveTab() 在入口处重定向，永远不会到达此分支
  const renderLeftPanel = () => {
    switch (activeTab) {
      case "settings":
        return <SettingsPanel />;
      default:
        return <ScriptView />;
    }
  };

  // Right panel content based on active tab
  const renderRightPanel = () => {
    return <RightPanel />;
  };

  return (
    <div className="h-full flex bg-background">
      {/* Left: TabBar - full height */}
      <TabBar />

      {/* Right content area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top: Project Header with save status */}
        <ProjectHeader />
        
        {/* Main content with resizable panels */}
        <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0 min-w-0">
        {/* Main content row */}
        <ResizablePanel defaultSize={85} minSize={50} className="min-h-0 min-w-0">
          <ResizablePanelGroup direction="horizontal" className="min-h-0 min-w-0">
            {/* Left Panel: Content based on active tab */}
            <ResizablePanel defaultSize={26} minSize={18} maxSize={40} className="min-w-0">
              <div className="h-full min-w-0 overflow-hidden bg-panel border-r border-border">
                {renderLeftPanel()}
              </div>
            </ResizablePanel>

            <ResizableHandle />

            {/* Center: Preview */}
            <ResizablePanel defaultSize={54} minSize={28} className="min-w-0">
              <div className="h-full min-w-0 overflow-hidden">
                <PreviewPanel />
              </div>
            </ResizablePanel>

            <ResizableHandle />

            {/* Right: Properties */}
            <ResizablePanel defaultSize={20} minSize={15} maxSize={32} className="min-w-0">
              <div className="h-full min-w-0 overflow-hidden border-l border-border">
                {renderRightPanel()}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        </ResizablePanelGroup>
      </div>
    </div>
  );
}
