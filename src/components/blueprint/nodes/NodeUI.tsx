// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Shared UI primitives for blueprint node internals.
 *
 * These are intentionally NOT Radix components — Radix portals and focus
 * management conflict with React Flow's drag/zoom behaviour. Plain HTML
 * elements with Tailwind classes work reliably inside node cards.
 */

import { useState } from 'react';
import { Loader2, StopCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Node Section ──────────────────────────────────────────────────────────

export function NodeSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mt-1.5 space-y-1', className)}>{children}</div>
  );
}

// ── Node Label ────────────────────────────────────────────────────────────

export function NodeLabel({
  icon,
  label,
  onRename,
  children,
}: {
  icon: string;
  label: string;
  /** 双击标题进入编辑；为空则不可编辑。 */
  onRename?: (next: string) => void;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== label) onRename?.(next);
    setEditing(false);
  };

  return (
    <div className="mb-1 flex items-center gap-1.5">
      <span className="text-xs">{icon}</span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(label);
              setEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="nodrag min-w-0 flex-1 rounded border border-primary/60 bg-background px-1 py-0.5 text-xs font-medium text-foreground outline-none"
        />
      ) : (
        <span
          className={cn(
            'truncate text-xs font-medium text-foreground',
            onRename && 'cursor-text select-none',
          )}
          title={onRename ? '双击重命名' : undefined}
          onDoubleClick={
            onRename
              ? (e) => {
                  e.stopPropagation();
                  setDraft(label);
                  setEditing(true);
                }
              : undefined
          }
        >
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

// ── Status Indicator ──────────────────────────────────────────────────────

const statusStyles: Record<string, string> = {
  completed: 'border-success',
  running: 'border-info animate-pulse',
  failed: 'border-destructive',
  stale: 'border-warning',
  queued: 'border-info/50',
  blocked: 'border-muted-foreground/40',
};

export function getNodeStatusColor(
  status?: string | null,
): string {
  return statusStyles[status ?? ''] ?? 'border-border';
}

// ── Node Card Shell ───────────────────────────────────────────────────────

export function NodeCard({
  selected,
  statusColor,
  className,
  children,
}: {
  selected?: boolean;
  statusColor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative rounded-lg border-2 bg-panel px-3 py-2 shadow-md transition-shadow',
        'min-w-[180px] max-w-[300px]',
        statusColor,
        selected && 'ring-2 ring-primary ring-offset-1',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Compact Select (native, works inside React Flow) ──────────────────────

export function NodeSelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      className={cn(
        'nodrag w-full rounded border border-input bg-background px-1.5 py-0.5',
        'text-[10px] text-foreground outline-none focus:border-primary',
        className,
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ── Compact Input (native, works inside React Flow) ───────────────────────

export function NodeInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      className={cn(
        'nodrag w-full rounded border border-input bg-background px-1.5 py-0.5',
        'text-[10px] text-foreground outline-none focus:border-primary',
        className,
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

// ── Textarea (native, works inside React Flow) ────────────────────────────

export function NodeTextarea({
  value,
  onChange,
  placeholder,
  rows = 2,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <textarea
      className={cn(
        'nodrag w-full resize-none rounded border border-input bg-background p-1.5',
        'text-xs text-foreground outline-none focus:border-primary',
        className,
      )}
      rows={rows}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ── Info Row (compact key-value display) ──────────────────────────────────

export function NodeInfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

// ── Progress Bar ──────────────────────────────────────────────────────────

export function NodeProgress({
  progress,
  className,
}: {
  progress: number;
  className?: string;
}) {
  // 引擎按 0–100 上报（NodeProgressUpdater）；兼容历史 0–1 数据。
  const percent = normalizeProgressPercent(progress);
  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className="h-full bg-info transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

// ── Running Overlay (progress + cancel, aligned with Studio style) ────────

/**
 * 归一化进度为 0–100 百分比。
 * 引擎 `NodeProgressUpdater` 按 0–100 上报；历史数据/测试可能存 0–1，
 * >1 的值按 0–100 刻度处理，避免显示 1000%。
 */
function normalizeProgressPercent(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0) return 0;
  if (progress <= 1) return Math.round(progress * 100);
  return Math.round(Math.min(100, progress));
}

/**
 * 运行中状态叠加层：覆盖在节点卡片上方，参考「自由」页图片/视频工作室
 * 的生成中样式 —— 居中 spinner + 进度百分比 + 底部进度条 + 取消按钮。
 *
 * - 点击「取消」调用 onCancel（最终走 store.cancelRun → abort 中止任务）。
 * - 覆盖层本身带 nodrag，避免拖拽节点时误触。
 * - progress 接受 0–100（引擎刻度）或 0–1（历史数据）。
 */
export function NodeRunningOverlay({
  progress,
  onCancel,
  label = '生成中',
  testId,
}: {
  progress: number;
  onCancel: () => void;
  label?: string;
  testId?: string;
}) {
  const percent = normalizeProgressPercent(progress);
  return (
    <div
      data-testid={testId}
      className={cn(
        'nodrag nowheel absolute inset-0 z-10 flex flex-col items-center justify-center gap-2',
        'rounded-lg border-2 border-info/60 bg-background/90 backdrop-blur-[2px]',
      )}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Spinner + percent */}
      <div className="flex items-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-[11px] font-medium text-foreground">
          {label}… {percent}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-[80%] overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Cancel button */}
      <button
        type="button"
        className={cn(
          'inline-flex h-6 items-center gap-1 rounded-md border border-input bg-background px-2',
          'text-[10px] text-foreground transition-colors hover:bg-muted',
        )}
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
      >
        <StopCircle className="h-3 w-3" />
        取消任务
      </button>
    </div>
  );
}

// ── Error Display ─────────────────────────────────────────────────────────

import { categorizeError, type ErrorCategory } from '@/lib/blueprint/error-utils';

/** Badge color classes per error category. */
const ERROR_CATEGORY_BADGE: Record<ErrorCategory, string> = {
  network: 'bg-info/15 text-info border-info/30',
  auth: 'bg-warning/15 text-warning border-warning/30',
  validation: 'bg-warning/15 text-warning border-warning/30',
  api: 'bg-destructive/15 text-destructive border-destructive/30',
  cancelled: 'bg-muted text-muted-foreground border-muted-foreground/30',
  blocked: 'bg-muted text-muted-foreground border-muted-foreground/30',
  unknown: 'bg-destructive/15 text-destructive border-destructive/30',
};

/** Short labels per error category. */
const ERROR_CATEGORY_LABEL: Record<ErrorCategory, string> = {
  network: '可恢复',
  auth: '需配置',
  validation: '参数错误',
  api: '服务错误',
  cancelled: '已取消',
  blocked: '上游阻断',
  unknown: '错误',
};

export function NodeError({ message }: { message: string }) {
  const info = categorizeError(message);
  return (
    <div className="mt-1 space-y-0.5">
      <div className="flex items-center gap-1">
        {info.recoverable && (
          <span
            className={cn(
              'inline-flex items-center rounded border px-1 text-[9px] font-medium',
              ERROR_CATEGORY_BADGE[info.category],
            )}
          >
            {ERROR_CATEGORY_LABEL[info.category]}
          </span>
        )}
        <span className="truncate text-[10px] text-destructive" title={info.message}>
          ⚠ {info.message}
        </span>
      </div>
      {info.recoveryAction && (
        <div className="truncate text-[9px] text-muted-foreground" title={info.recoveryAction}>
          {info.recoveryIcon} {info.recoveryAction}
        </div>
      )}
    </div>
  );
}

// ── File Drop Zone ────────────────────────────────────────────────────────

export function NodeDropZone({
  label,
  onFiles,
  accept,
  multiple = true,
  className,
}: {
  label: string;
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'nodrag flex cursor-pointer items-center justify-center rounded border border-dashed',
        'border-muted-foreground/40 bg-muted/30 p-2 text-[10px] text-muted-foreground',
        'transition-colors hover:border-primary hover:bg-primary/5',
        className,
      )}
    >
      <input
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          e.target.value = '';
        }}
      />
      {label}
    </label>
  );
}

// ── Thumbnail Grid ────────────────────────────────────────────────────────

export function NodeThumbnailGrid({
  items,
  onRemove,
  maxVisible = 3,
}: {
  items: Array<{ id?: string; url?: string; localPath?: string; label?: string }>;
  onRemove?: (index: number) => void;
  maxVisible?: number;
}) {
  if (items.length === 0) return null;

  const visible = items.slice(0, maxVisible);
  const extra = items.length - maxVisible;

  return (
    <div className="flex gap-1 overflow-hidden">
      {visible.map((item, i) => (
        <div
          key={item.id ?? item.url ?? i}
          className="group relative h-10 w-10 shrink-0 overflow-hidden rounded border border-border bg-muted"
        >
          {item.url ? (
            <img
              src={item.url}
              alt={item.label ?? `素材 ${i + 1}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[8px] text-muted-foreground">
              {item.label ?? `#${i + 1}`}
            </div>
          )}
          {onRemove && (
            <button
              className="nodrag absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(i);
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {extra > 0 && (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-muted text-[10px] text-muted-foreground">
          +{extra}
        </div>
      )}
    </div>
  );
}
