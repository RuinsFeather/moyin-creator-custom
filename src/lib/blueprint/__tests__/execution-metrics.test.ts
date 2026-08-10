// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBlueprintMetrics,
  getExecutionFailureRate,
  getRecoverySuccessRate,
  getExecutionCount,
  recordBlueprintRun,
  recordTaskRecovery,
  recordDuplicateTask,
  recordMediaFailure,
  resetBlueprintMetrics,
  type ExecutionRunMetric,
} from '../execution-metrics';

function runMetric(
  overrides: Partial<ExecutionRunMetric> = {},
): ExecutionRunMetric {
  return {
    runId: 'run-1',
    mode: 'all',
    startedAt: 1000,
    elapsedMs: 500,
    completed: 3,
    failed: 0,
    cancelled: 0,
    blocked: 0,
    errorSummary: [],
    ...overrides,
  };
}

describe('execution-metrics', () => {
  beforeEach(() => {
    resetBlueprintMetrics();
  });

  it('初始状态为空且失败率为 0', () => {
    expect(getBlueprintMetrics().runs).toEqual([]);
    expect(getBlueprintMetrics().recoveries).toEqual([]);
    expect(getExecutionFailureRate()).toBe(0);
    expect(getExecutionCount()).toBe(0);
  });

  it('无恢复记录时恢复成功率为 1（视为健全）', () => {
    expect(getRecoverySuccessRate()).toBe(1);
  });

  it('recordBlueprintRun 后执行计数增加', () => {
    recordBlueprintRun(runMetric());
    recordBlueprintRun(runMetric({ runId: 'run-2' }));
    expect(getExecutionCount()).toBe(2);
  });

  it('失败率 = 失败节点数 / 总节点数', () => {
    recordBlueprintRun(
      runMetric({ runId: 'r1', completed: 8, failed: 2, cancelled: 0, blocked: 0 }),
    );
    expect(getExecutionFailureRate()).toBeCloseTo(2 / 10);
  });

  it('失败率将取消与阻塞节点计入分母', () => {
    recordBlueprintRun(
      runMetric({ runId: 'r1', completed: 1, failed: 1, cancelled: 1, blocked: 1 }),
    );
    expect(getExecutionFailureRate()).toBeCloseTo(1 / 4);
  });

  it('recordTaskRecovery 计算恢复成功率', () => {
    recordTaskRecovery({ timestamp: 1, ok: true, nodeCount: 3 });
    recordTaskRecovery({ timestamp: 2, ok: true, nodeCount: 2 });
    recordTaskRecovery({ timestamp: 3, ok: false, nodeCount: 0, error: 'boom' });
    expect(getRecoverySuccessRate()).toBeCloseTo(2 / 3);
  });

  it('recordDuplicateTask 与 recordMediaFailure 记录事件', () => {
    recordDuplicateTask({ timestamp: 1, taskId: 't1', nodeId: 'n1' });
    recordMediaFailure({ timestamp: 2, nodeId: 'n2', error: 'disk full' });
    const m = getBlueprintMetrics();
    expect(m.duplicateTasks).toHaveLength(1);
    expect(m.duplicateTasks[0].taskId).toBe('t1');
    expect(m.mediaFailures).toHaveLength(1);
    expect(m.mediaFailures[0].error).toBe('disk full');
  });

  it('maxHistory 限制各队列上限为 200', () => {
    for (let i = 0; i < 250; i++) {
      recordBlueprintRun(runMetric({ runId: `run-${i}` }));
      recordTaskRecovery({ timestamp: i, ok: true, nodeCount: 1 });
      recordDuplicateTask({ timestamp: i, taskId: `t${i}` });
      recordMediaFailure({ timestamp: i, error: `e${i}` });
    }
    const m = getBlueprintMetrics();
    expect(m.runs).toHaveLength(200);
    expect(m.recoveries).toHaveLength(200);
    expect(m.duplicateTasks).toHaveLength(200);
    expect(m.mediaFailures).toHaveLength(200);
    // 最旧的一条被淘汰
    expect(m.runs[0].runId).toBe('run-50');
  });

  it('resetBlueprintMetrics 清空所有数据', () => {
    recordBlueprintRun(runMetric());
    recordTaskRecovery({ timestamp: 1, ok: true, nodeCount: 1 });
    resetBlueprintMetrics();
    expect(getBlueprintMetrics().runs).toEqual([]);
    expect(getBlueprintMetrics().recoveries).toEqual([]);
    expect(getExecutionCount()).toBe(0);
  });
});
