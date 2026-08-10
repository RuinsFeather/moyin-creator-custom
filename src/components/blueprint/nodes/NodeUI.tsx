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
  children,
}: {
  icon: string;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <span className="text-xs">{icon}</span>
      <span className="truncate text-xs font-medium text-foreground">
        {label}
      </span>
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
  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className="h-full bg-info transition-all"
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
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
