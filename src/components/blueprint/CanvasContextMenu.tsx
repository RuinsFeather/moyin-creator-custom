// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// CanvasContextMenu — right-click context menu on the canvas pane.
// §2.5 / P1-6.
//
// Displays the same BOX_CATALOG used by the toolbar's "＋ 添加窗口" menu,
// creating boxes at the exact right-click position using screenToFlowPosition.

import { memo, useCallback, useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { BlueprintNodeType, BlueprintNode } from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { generateUUID } from '@/lib/utils';

/** Catalog item: one creatable box type. */
export interface BoxCatalogItem {
  type: BlueprintNodeType;
  icon: string;
  label: string;
  description: string;
}

/** Catalog group: a visual section in the menu. */
interface BoxCatalogGroup {
  label: string;
  items: BoxCatalogItem[];
}

/**
 * BOX_CATALOG — the single source of truth for all creatable box types.
 * This same constant will be consumed by BlueprintToolbar's "＋ 添加窗口"
 * menu (P1-8), ensuring both entry points offer identical options.
 */
export const BOX_CATALOG: BoxCatalogGroup[] = [
  {
    label: '窗口',
    items: [
      {
        type: 'text-box',
        icon: '📝',
        label: '文本',
        description: '提示词、台词、上下文',
      },
      {
        type: 'image-box',
        icon: '🖼️',
        label: '图片',
        description: '上传或生成图片',
      },
      {
        type: 'video-box',
        icon: '🎬',
        label: '视频',
        description: '上传或生成视频',
      },
    ],
  },
  {
    label: '高级',
    items: [
      {
        type: 'script-import',
        icon: '📜',
        label: '剧本导入',
        description: '从项目剧本导入分镜',
      },
    ],
  },
];

/** Default config factory per node type. */
function getDefaultConfig(nodeType: BlueprintNodeType): Record<string, unknown> {
  switch (nodeType) {
    case 'text-box':
      return { text: '', language: '', role: '', skillRefs: [] };
    case 'image-box':
      return { media: [] };
    case 'video-box':
      return { media: [] };
    case 'script-import':
      return { selectedShotIds: [], mode: 'snapshot' };
    default:
      return {};
  }
}

export interface CanvasContextMenuProps {
  /** Screen x coordinate (clientX from MouseEvent). */
  x: number;
  /** Screen y coordinate (clientY from MouseEvent). */
  y: number;
  /** Callback to close the menu. */
  onClose: () => void;
}

function CanvasContextMenuComponent({ x, y, onClose }: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useBlueprintStore((s) => s.addNode);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleCreate = useCallback(
    (item: BoxCatalogItem) => {
      // Convert screen coordinates to flow coordinates
      const position = screenToFlowPosition({ x, y });

      const id = generateUUID();
      addNode({
        id,
        type: item.type,
        position,
        data: {
          nodeType: item.type,
          label: item.label,
          config: getDefaultConfig(item.type),
        },
      } as BlueprintNode);

      onClose();
    },
    [x, y, screenToFlowPosition, addNode, onClose],
  );

  return (
    <div
      ref={menuRef}
      data-testid="canvas-context-menu"
      className="fixed z-50 w-56 rounded-lg border border-border bg-panel p-1.5 shadow-xl"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {BOX_CATALOG.map((group) => (
        <div key={group.label} className="mb-1.5 last:mb-0">
          <div className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {group.label}
          </div>
          {group.items.map((item) => (
            <button
              key={item.type}
              onClick={() => handleCreate(item)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
            >
              <span className="text-sm">{item.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-foreground">{item.label}</div>
                <div className="text-[10px] text-muted-foreground">{item.description}</div>
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Canvas right-click context menu. */
export const CanvasContextMenu = memo(CanvasContextMenuComponent);
