// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL_LICENSE.md.
//
// ReferenceList — shared reference-thumbnail strip used by both the freedom
// studios and the blueprint BoxConfigDrawer (§2.4 ① / P2-1 / P2-4).
//
// Design constraints:
// - Zero behavior change when the studios consume it (组件搬移零行为变更).
// - Renders a single-row horizontally-scrollable strip of small thumbnails
//   (36×36) with source badges (◇ edge / ◆ manual / ▲ asset library),
//   sequence numbers, hover preview + delete, and drag-to-reorder.
// - Fully controlled: the parent owns the ordered list and the callbacks.

import { useCallback, useRef, useState } from 'react';
import { X, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Where a reference came from — drives the badge glyph. */
export type ReferenceSourceKind = 'edge' | 'manual' | 'library';

/** Media type of a reference (drives the corner tag). */
export type ReferenceMediaType = 'image' | 'video' | 'audio';

/** A single entry in the unified reference list. */
export interface ReferenceItem {
  /** Stable key for React lists. */
  key: string;
  /** Thumbnail URL (data URL / blob URL / http URL). */
  url: string;
  /** Display file name (used for hover title). */
  name?: string;
  /** Source badge kind. */
  source: ReferenceSourceKind;
  /** Human label for the source (e.g. upstream box name / 手动 / 素材库). */
  sourceLabel?: string;
  /** Media type; images render an <img>, others render a type glyph. */
  mediaType?: ReferenceMediaType;
  /** Optional role tag (首帧/尾帧/参考) shown as corner badge (video). */
  role?: string;
  /** Whether the item can be removed (edge refs are derived, not stored). */
  removable?: boolean;
}

export interface ReferenceListProps {
  /** Ordered reference entries (parent-owned). */
  items: ReferenceItem[];
  /** Fired when the user removes an item (delete button). */
  onRemove?: (key: string) => void;
  /**
   * Fired after a drag-to-reorder finishes with the new ordering
   * (array of keys in the new order).
   */
  onReorder?: (keys: string[]) => void;
  /** Fired when the user right-clicks a thumbnail (video: insert tag). */
  onItemContextMenu?: (key: string) => void;
  /**
   * Fired when the user clicks the role tag (video: cycle 首帧/尾帧/参考).
   * Only wired when provided; the tag becomes interactive (pointer-events).
   */
  onRoleClick?: (key: string) => void;
  /** Whether reordering is enabled (default true when onReorder given). */
  reorderable?: boolean;
  /** Extra class on the outer strip. */
  className?: string;
  /** Height of each thumbnail in px (default 36). */
  thumbSize?: number;
}

const SOURCE_GLYPH: Record<ReferenceSourceKind, string> = {
  edge: '◇',
  manual: '◆',
  library: '▲',
};

const SOURCE_TITLE: Record<ReferenceSourceKind, string> = {
  edge: '连线参考',
  manual: '手动添加',
  library: '素材库',
};

const MEDIA_TYPE_TAG: Record<ReferenceMediaType, string> = {
  image: '',
  video: '▶',
  audio: '♪',
};

/**
 * Single-row thumbnail strip. Drag to reorder (HTML5 drag events — light and
 * dependency-free), hover for enlarged preview + delete, right-click for the
 * context insert (video drawer).
 */
export function ReferenceList({
  items,
  onRemove,
  onReorder,
  onItemContextMenu,
  onRoleClick,
  reorderable = true,
  className,
  thumbSize = 36,
}: ReferenceListProps) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const dragImageRef = useRef<HTMLImageElement | null>(null);

  const canReorder = reorderable && !!onReorder && items.length > 1;

  const handleDragStart = useCallback(
    (e: React.DragEvent, key: string) => {
      if (!canReorder) return;
      setDragKey(key);
      // DataTransfer required for Firefox to initiate the drag
      try {
        e.dataTransfer.setData('text/plain', key);
        e.dataTransfer.effectAllowed = 'move';
      } catch {
        // jsdom / restricted environments
      }
    },
    [canReorder],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, key: string) => {
      if (!canReorder || !dragKey || dragKey === key) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropKey(key);
    },
    [canReorder, dragKey],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, targetKey: string) => {
      e.preventDefault();
      setDropKey(null);
      if (!canReorder || !dragKey || dragKey === targetKey) {
        setDragKey(null);
        return;
      }
      const keys = items.map((i) => i.key);
      const from = keys.indexOf(dragKey);
      const to = keys.indexOf(targetKey);
      if (from < 0 || to < 0) {
        setDragKey(null);
        return;
      }
      keys.splice(to, 0, keys.splice(from, 1)[0]);
      onReorder?.(keys);
      setDragKey(null);
    },
    [canReorder, dragKey, items, onReorder],
  );

  const handleDragEnd = useCallback(() => {
    setDragKey(null);
    setDropKey(null);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        'nodrag nowheel flex items-center gap-1 overflow-x-auto py-1',
        className,
      )}
      style={{ maxHeight: 48 }}
      data-testid="reference-list"
    >
      {items.map((item, index) => {
        const removable = item.removable !== false && !!onRemove;
        const isDragging = dragKey === item.key;
        const isDropTarget = dropKey === item.key && dragKey !== item.key;
        return (
          <div
            key={item.key}
            className={cn(
              'group/ref relative shrink-0 select-none rounded border bg-muted/40',
              canReorder && 'cursor-grab active:cursor-grabbing',
              isDragging && 'opacity-40',
              isDropTarget && 'border-primary ring-1 ring-primary/50',
            )}
            style={{ width: thumbSize, height: thumbSize }}
            draggable={canReorder}
            onDragStart={(e) => handleDragStart(e, item.key)}
            onDragOver={(e) => handleDragOver(e, item.key)}
            onDrop={(e) => handleDrop(e, item.key)}
            onDragEnd={handleDragEnd}
            onContextMenu={(e) => {
              if (onItemContextMenu) {
                e.preventDefault();
                onItemContextMenu(item.key);
              }
            }}
            title={item.name ? `${item.name}（${SOURCE_TITLE[item.source]}）` : SOURCE_TITLE[item.source]}
            data-testid={`reference-item-${index}`}
            data-reference-key={item.key}
          >
            {item.mediaType === 'image' || !item.mediaType ? (
              <img
                ref={index === 0 ? dragImageRef : undefined}
                src={item.url}
                alt={item.name ?? `参考 ${index + 1}`}
                className="h-full w-full rounded object-cover"
                draggable={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded text-[10px] text-muted-foreground">
                {item.mediaType === 'video' ? '🎬' : '🎵'}
              </div>
            )}

            {/* Sequence number (top-left) */}
            <span className="pointer-events-none absolute left-0 top-0 rounded-br bg-black/60 px-[3px] text-[8px] leading-[10px] font-medium text-white">
              {index + 1}
            </span>

            {/* Source badge (bottom-left) */}
            <span
              className="pointer-events-none absolute bottom-0 left-0 rounded-tr bg-black/60 px-[3px] text-[8px] leading-[10px] text-white"
              title={`${SOURCE_TITLE[item.source]}${item.sourceLabel ? ` · ${item.sourceLabel}` : ''}`}
            >
              {SOURCE_GLYPH[item.source]}
            </span>

            {/* Media type tag (top-right) */}
            {item.mediaType && MEDIA_TYPE_TAG[item.mediaType] && (
              <span className="pointer-events-none absolute right-0 top-0 rounded-bl bg-black/60 px-[3px] text-[8px] leading-[10px] text-white">
                {MEDIA_TYPE_TAG[item.mediaType]}
              </span>
            )}

            {/* Role tag (bottom-right) — clickable when onRoleClick provided */}
            {item.role && (
              <span
                className={cn(
                  'absolute bottom-0 right-0 rounded-tl bg-primary/90 px-[3px] text-[8px] leading-[10px] text-primary-foreground',
                  onRoleClick
                    ? 'pointer-events-auto cursor-pointer hover:bg-primary'
                    : 'pointer-events-none',
                )}
                onClick={
                  onRoleClick
                    ? (e) => {
                        e.stopPropagation();
                        onRoleClick(item.key);
                      }
                    : undefined
                }
                title={onRoleClick ? '点击切换角色（首帧/尾帧/参考）' : undefined}
              >
                {item.role}
              </span>
            )}

            {/* Delete button (hover only) */}
            {removable && (
              <button
                type="button"
                className="absolute -right-1 -top-1 hidden rounded-full bg-destructive p-[2px] text-destructive-foreground shadow group-hover/ref:block"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove?.(item.key);
                }}
                aria-label={`删除参考 ${index + 1}`}
                title="删除"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}

            {/* Drag affordance (hover only) */}
            {canReorder && (
              <GripVertical className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded bg-black/50 p-[1px] text-white group-hover/ref:block" />
            )}
          </div>
        );
      })}
    </div>
  );
}
