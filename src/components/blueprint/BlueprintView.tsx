// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { BlueprintCanvas } from './BlueprintCanvas';
import { BlueprintToolbar } from './BlueprintToolbar';
import { PropertiesPanel } from './PropertiesPanel';
import { ExecutionMetricsPanel } from './ExecutionMetricsPanel';
import { undo, redo } from '@/lib/blueprint/undo-redo';
import { BlueprintOnboarding } from './BlueprintOnboarding';

/**
 * BlueprintView — top-level container for the blueprint editor tab.
 *
 * Responsibilities:
 * - Wraps the canvas in a ReactFlowProvider (required by @xyflow/react).
 * - Provides a header bar with the active blueprint name.
 * - Handles "create first blueprint" when none exists yet.
 */
export function BlueprintView() {
  const activeBlueprintId = useBlueprintStore((s) => s.activeBlueprintId);
  const blueprints = useBlueprintStore((s) => s.blueprints);
  const activeProjectId = useBlueprintStore((s) => s.activeProjectId);
  const createBlueprint = useBlueprintStore((s) => s.createBlueprint);
  const setActiveBlueprint = useBlueprintStore((s) => s.setActiveBlueprint);

  const activeBlueprint = blueprints.find((b) => b.id === activeBlueprintId) ?? null;
  const projectBlueprints = blueprints.filter(
    (b) => b.projectId === activeProjectId && b.status !== 'archived',
  );

  const handleCreateBlueprint = useCallback(() => {
    createBlueprint();
  }, [createBlueprint]);

  const [localBlueprintId, setLocalBlueprintId] = useState(activeBlueprintId ?? '');
  const [metricsOpen, setMetricsOpen] = useState(false);

  // Keep local state in sync when store changes externally (e.g., after create/delete)
  useEffect(() => {
    setLocalBlueprintId(activeBlueprintId ?? '');
  }, [activeBlueprintId]);

  const handleSelectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setLocalBlueprintId(value);
      setActiveBlueprint(value || null);
    },
    [setActiveBlueprint],
  );

  // ── Keyboard shortcuts for undo/redo (§11.1) ─────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Z / Cmd+Z → undo;  Ctrl+Shift+Z / Cmd+Shift+Z → redo
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key !== 'z' && e.key !== 'Z') return;

      // Don't intercept when focus is inside an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!activeProjectId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>请先选择一个项目</p>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col bg-background">
        {/* Header bar */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">蓝图</span>
            {projectBlueprints.length > 1 && (
              <select
                className="rounded border border-input bg-background px-1.5 py-0.5 text-xs text-foreground"
                value={localBlueprintId}
                onChange={handleSelectChange}
              >
                {projectBlueprints.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            {activeBlueprint && (
              <span className="truncate text-sm font-medium text-foreground">
                {activeBlueprint.name}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setMetricsOpen((v) => !v)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                metricsOpen
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-muted/40 text-muted-foreground hover:bg-muted'
              }`}
              title="执行健康指标（P1-4）"
            >
              📊 指标
            </button>
            {projectBlueprints.length === 0 && (
              <button
                onClick={handleCreateBlueprint}
                className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
              >
                创建蓝图
              </button>
            )}
          </div>
        </div>

        {/* Toolbar + Canvas + PropertiesPanel */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <BlueprintToolbar />
            <div className="relative flex-1 overflow-hidden">
              <BlueprintCanvas />
              {metricsOpen && (
                <div className="absolute right-2 top-2 z-10 w-64 rounded-lg border border-border bg-panel/95 p-2 shadow-lg backdrop-blur">
                  <ExecutionMetricsPanel />
                </div>
              )}
            </div>
          </div>
          <PropertiesPanel />
        </div>
      </div>
      <BlueprintOnboarding />
    </ReactFlowProvider>
  );
}
