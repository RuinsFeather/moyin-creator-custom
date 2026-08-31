import { describe, it, expect } from 'vitest';
import {
  applyContextBudget,
  computeCharBudget,
  getContextWindowForModel,
  type BudgetInputFile,
} from '../agent-context-budget';

function file(path: string, content: string, editable = true): BudgetInputFile {
  return { path, name: path.split('/').pop() ?? path, type: 'text', content, editable };
}

describe('computeCharBudget', () => {
  it('按 contextWindow × 70% × 1.5 反算字符预算', () => {
    // 32000 tokens → 32000 × 0.7 × 1.5 = 33600
    expect(computeCharBudget(32000)).toBe(33600);
    // 128000 tokens → 134400
    expect(computeCharBudget(128000)).toBe(134400);
  });
});

describe('getContextWindowForModel', () => {
  it('已知模型查注册表', () => {
    expect(getContextWindowForModel('glm-4.7')).toBe(200000);
    expect(getContextWindowForModel('gemini-2.5-flash')).toBe(1048576);
  });

  it('前缀匹配生效', () => {
    expect(getContextWindowForModel('deepseek-v3-custom')).toBe(128000);
  });

  it('未知/空模型走 32K 兜底', () => {
    expect(getContextWindowForModel('totally-unknown-model')).toBe(32000);
    expect(getContextWindowForModel('')).toBe(32000);
    expect(getContextWindowForModel(null)).toBe(32000);
  });
});

describe('applyContextBudget', () => {
  it('预算充足时所有文件全文发送', () => {
    const result = applyContextBudget(
      [file('a.md', 'hello'), file('b.md', 'world')],
      new Set(['a.md']),
      10000,
    );
    expect(result.fullCount).toBe(2);
    expect(result.degradedCount).toBe(0);
    expect(result.files[0].content).toBe('hello');
    expect(result.files[0].full).toBe(true);
  });

  it('优先文件先吃预算：大预算内优先文件全文、其余降级摘要', () => {
    const big = 'x'.repeat(8000);
    const result = applyContextBudget(
      [file('prio.md', big), file('other.md', big)],
      new Set(['prio.md']),
      9000, // 只够一个优先文件
    );
    expect(result.files.find((f) => f.path === 'prio.md')?.full).toBe(true);
    const other = result.files.find((f) => f.path === 'other.md');
    expect(other?.full).toBe(false);
    expect(other?.content).toContain('超出上下文预算');
    expect(result.degradedCount).toBe(1);
  });

  it('优先文件超预算时截断并标记，其余降级', () => {
    const big = 'y'.repeat(5000);
    const result = applyContextBudget(
      [file('prio.md', big), file('other.md', 'z')],
      new Set(['prio.md']),
      3000,
    );
    const prio = result.files.find((f) => f.path === 'prio.md');
    expect(prio?.full).toBe(false);
    expect(prio?.content).toContain('正文已按预算截断');
    expect(prio?.content.length).toBeLessThan(5000);
    expect(result.files.find((f) => f.path === 'other.md')?.full).toBe(false);
  });

  it('非 editable 文件始终为占位摘要，不计入降级数', () => {
    const result = applyContextBudget(
      [file('bin.png', '\0\0', false), file('a.md', 'ok')],
      new Set(['a.md']),
      1000,
    );
    const bin = result.files.find((f) => f.path === 'bin.png');
    expect(bin?.content).toBe('[正文未载入]');
    expect(result.degradedCount).toBe(0);
  });

  it('预算耗尽后优先文件也降级', () => {
    const big = 'w'.repeat(4000);
    const first = applyContextBudget([file('a.md', big)], new Set(['a.md']), 4000);
    expect(first.files[0].full).toBe(true);
    const second = applyContextBudget(
      [file('a.md', big), file('b.md', big)],
      new Set(['a.md', 'b.md']),
      5000, // a 吃掉 4000+ 后 b 只剩不到 1000
    );
    const b = second.files.find((f) => f.path === 'b.md');
    expect(b?.full).toBe(false);
    expect(b?.content).toContain('正文已按预算截断');
  });
});
