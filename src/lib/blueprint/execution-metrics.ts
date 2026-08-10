// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Blueprint Execution Metrics (P1-4 异常指标)
//
// Lightweight in-memory telemetry for blueprint execution, task recovery,
// duplicate-task and media-library failures. Data is kept in-memory for the
// session (no external backend yet) so the UI can surface a health overview
// without adding a network dependency.
//
// Metrics tracked:
//   - execution: 执行次数、成功/失败/取消/阻塞节点数、耗时
//   - recovery: 任务恢复尝试次数、成功/失败数
//   - duplicate: 重复任务
//   - media: 媒体落库失败次数

export type ExecutionOutcome =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export interface ExecutionRunMetric {
  runId: string;
  mode: 'all' | 'node' | 'downstream';
  startedAt: number;
  elapsedMs: number;
  completed: number;
  failed: number;
  cancelled: number;
  blocked: number;
  errorSummary: string[];
}

export interface RecoveryMetric {
  timestamp: number;
  ok: boolean;
  nodeCount: number;
  error?: string;
}

export interface DuplicateTaskMetric {
  timestamp: number;
  taskId: string;
  nodeId?: string;
}

export interface MediaFailureMetric {
  timestamp: number;
  nodeId?: string;
  error: string;
}

interface BlueprintMetricsState {
  runs: ExecutionRunMetric[];
  recoveries: RecoveryMetric[];
  duplicateTasks: DuplicateTaskMetric[];
  mediaFailures: MediaFailureMetric[];
  /** 最近 200 次执行/恢复/上报事件，用于趋势展示。 */
  maxHistory: number;
}

const initialState: BlueprintMetricsState = {
  runs: [],
  recoveries: [],
  duplicateTasks: [],
  mediaFailures: [],
  maxHistory: 200,
};

let state: BlueprintMetricsState = { ...initialState };

// ── Getters ───────────────────────────────────────────────────────────────

export function getBlueprintMetrics() {
  return state;
}

/** 综合执行失败率（0-1）。无执行记录时返回 0。 */
export function getExecutionFailureRate(): number {
  const runs = state.runs;
  if (runs.length === 0) return 0;
  const totalNodes = runs.reduce(
    (sum, r) => sum + r.completed + r.failed + r.cancelled + r.blocked,
    0,
  );
  if (totalNodes === 0) return 0;
  const failedNodes = runs.reduce((sum, r) => sum + r.failed, 0);
  return failedNodes / totalNodes;
}

/** 恢复成功率（0-1）。无恢复尝试时返回 1（视为健全）。 */
export function getRecoverySuccessRate(): number {
  const recs = state.recoveries;
  if (recs.length === 0) return 1;
  return recs.filter((r) => r.ok).length / recs.length;
}

/** 执行总次数。 */
export function getExecutionCount(): number {
  return state.runs.length;
}

// ── Recorders ─────────────────────────────────────────────────────────────

/** Record a completed blueprint run. */
export function recordBlueprintRun(metric: ExecutionRunMetric): void {
  state = {
    ...state,
    runs: [...state.runs, metric].slice(-state.maxHistory),
  };
}

/** Record a task-recovery attempt. */
export function recordTaskRecovery(metric: RecoveryMetric): void {
  state = {
    ...state,
    recoveries: [...state.recoveries, metric].slice(-state.maxHistory),
  };
}

/** Record a duplicate-task event (dedupe guard tripped). */
export function recordDuplicateTask(metric: DuplicateTaskMetric): void {
  state = {
    ...state,
    duplicateTasks: [...state.duplicateTasks, metric].slice(-state.maxHistory),
  };
}

/** Record a media-library write failure. */
export function recordMediaFailure(metric: MediaFailureMetric): void {
  state = {
    ...state,
    mediaFailures: [...state.mediaFailures, metric].slice(-state.maxHistory),
  };
}

/** Reset all metrics (used by tests / debugging). */
export function resetBlueprintMetrics(): void {
  state = { ...initialState };
}