// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Blueprint Execution Metrics Panel (P1-4 异常指标)
//
// Lightweight in-memory health overview for blueprint executions:
// 执行失败率、恢复成功率、重复任务数、媒体落库失败数、最近执行列表。

import { useEffect, useState } from 'react';
import {
  getBlueprintMetrics,
  getExecutionFailureRate,
  getRecoverySuccessRate,
  getExecutionCount,
} from '@/lib/blueprint/execution-metrics';

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function MetricCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-success'
      : tone === 'warn'
        ? 'text-warning'
        : tone === 'bad'
          ? 'text-destructive'
          : 'text-foreground';
  return (
    <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

/** 蓝图执行健康概览面板（P1-4）。 */
export function ExecutionMetricsPanel() {
  const [, setTick] = useState(0);

  // Re-render every 2s to pick up new metrics while a run is in progress.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 2000);
    return () => window.clearInterval(timer);
  }, []);

  const metrics = getBlueprintMetrics();
  const failureRate = getExecutionFailureRate();
  const recoveryRate = getRecoverySuccessRate();
  const runCount = getExecutionCount();

  const hasData =
    runCount > 0 ||
    metrics.recoveries.length > 0 ||
    metrics.duplicateTasks.length > 0 ||
    metrics.mediaFailures.length > 0;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-foreground">执行健康指标</div>

      {!hasData ? (
        <div className="rounded border border-border bg-muted/20 p-2 text-[10px] text-muted-foreground">
          暂无执行记录。运行蓝图后这里会显示失败率、恢复成功率等异常指标。
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <MetricCard
              label="执行次数"
              value={String(runCount)}
            />
            <MetricCard
              label="失败率"
              value={formatPct(failureRate)}
              tone={failureRate === 0 ? 'good' : failureRate < 0.15 ? 'warn' : 'bad'}
            />
            <MetricCard
              label="恢复成功率"
              value={formatPct(recoveryRate)}
              tone={recoveryRate >= 1 ? 'good' : recoveryRate >= 0.5 ? 'warn' : 'bad'}
            />
            <MetricCard
              label="重复任务"
              value={String(metrics.duplicateTasks.length)}
              tone={metrics.duplicateTasks.length > 0 ? 'warn' : 'good'}
            />
          </div>

          {metrics.mediaFailures.length > 0 && (
            <div className="rounded border border-destructive/30 bg-destructive/10 p-1.5 text-[10px] text-destructive">
              媒体落库失败 {metrics.mediaFailures.length} 次
            </div>
          )}

          {metrics.runs.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] text-muted-foreground">最近执行</div>
              {metrics.runs
                .slice()
                .reverse()
                .slice(0, 5)
                .map((run) => (
                  <div
                    key={run.runId}
                    className="flex items-center justify-between rounded border border-border bg-muted/20 px-1.5 py-1 text-[9px]"
                  >
                    <span className="text-muted-foreground">
                      {formatTime(run.startedAt)} · {run.mode === 'all' ? '全部' : run.mode === 'node' ? '选中' : '下游'}
                    </span>
                    <span
                      className={
                        run.failed > 0
                          ? 'font-medium text-destructive'
                          : run.cancelled > 0
                            ? 'font-medium text-warning'
                            : 'font-medium text-success'
                      }
                    >
                      ✓{run.completed}
                      {run.failed > 0 ? ` ✗${run.failed}` : ''}
                      {run.cancelled > 0 ? ` ⏹${run.cancelled}` : ''}
                      {run.blocked > 0 ? ` ⊘${run.blocked}` : ''}
                      <span className="ml-1 text-muted-foreground">
                        {(run.elapsedMs / 1000).toFixed(1)}s
                      </span>
                    </span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}