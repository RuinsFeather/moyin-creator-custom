// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL_LICENSE.md.
//
// GenParamControls — capability-driven generation parameter controls shared
// by the freedom studios (ImageStudio/VideoStudio) and the blueprint
// BoxConfigDrawer (§2.4 ③ / P2-1 / P2-7).
//
// The component is a controlled leaf: it renders aspect-ratio / resolution /
// duration controls (image or video flavor) driven by the model-registry
// capability helpers, with the same fallback lists the studios use.
//
// Studios consume it with their exact original styling (non-compact +
// descriptions) — 组件搬移零行为变更; the drawer consumes the compact flavor.

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  getT2IModelById,
  getAspectRatiosForT2IModel,
  getAspectRatiosForT2VModel,
  getResolutionsForModel,
} from '@/lib/freedom/model-registry';

export const IMAGE_DEFAULT_ASPECT_RATIOS = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'];
export const IMAGE_DEFAULT_RESOLUTIONS = ['1K', '2K', '4K'];
export const VIDEO_DEFAULT_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export const VIDEO_DEFAULT_RESOLUTIONS = ['480p', '720p', '1080p', '4k'];

export interface GenParamControlsProps {
  kind: 'image' | 'video';
  /** Selected model id (empty = none). */
  model: string;
  /**
   * Capability-resolved model id (e.g. versioned Kling/Veo ids normalized to
   * their family base). Falls back to `model` when omitted.
   */
  capabilityModelId?: string;
  /** Current aspect ratio value. */
  aspectRatio: string;
  onAspectRatioChange: (value: string) => void;
  /** Current resolution value (string, e.g. '2K' / '720p'). */
  resolution: string;
  onResolutionChange: (value: string) => void;
  /** Video only: current duration in seconds. */
  duration?: number;
  onDurationChange?: (value: number) => void;
  /** Video duration bounds (defaults 4–15; seedance capability may widen). */
  durationMin?: number;
  durationMax?: number;
  /** Compact rendering for drawer use (smaller buttons, tighter spacing). */
  compact?: boolean;
  /**
   * Root vertical spacing between parameter groups. Studios pass "space-y-5"
   * to match their parent layout exactly (zero behavior change).
   */
  groupClassName?: string;
  /** Optional per-value description tooltips (studio style). */
  aspectRatioDescriptions?: Record<string, string>;
  resolutionDescriptions?: Record<string, string>;
  /** Whether resolution buttons append the description to their label (VideoStudio style). */
  resolutionLabelWithDescription?: boolean;
}

/**
 * Capability-driven parameter controls. The visible parameter set adapts to
 * the selected model via the registry helpers:
 * - image: aspectRatio (buttons) + resolution (select)
 * - video: aspectRatio (buttons) + resolution (buttons) + duration (slider + input)
 */
export function GenParamControls({
  kind,
  model,
  capabilityModelId,
  aspectRatio,
  onAspectRatioChange,
  resolution,
  onResolutionChange,
  duration,
  onDurationChange,
  durationMin = 4,
  durationMax = 15,
  compact = false,
  groupClassName = 'space-y-3',
  aspectRatioDescriptions,
  resolutionDescriptions,
  resolutionLabelWithDescription = false,
}: GenParamControlsProps) {
  const capModel = capabilityModelId || model;

  const aspectRatios = useMemo(() => {
    if (kind === 'image') {
      const list = getAspectRatiosForT2IModel(capModel);
      return list.length > 0 ? (list.includes('auto') ? list : ['auto', ...list]) : IMAGE_DEFAULT_ASPECT_RATIOS;
    }
    const list = getAspectRatiosForT2VModel(capModel);
    return list.length > 0 ? list : VIDEO_DEFAULT_ASPECT_RATIOS;
  }, [kind, capModel]);

  const resolutions = useMemo(() => {
    if (kind === 'image') {
      const list = (getT2IModelById(capModel)?.inputs?.resolution?.enum as string[]) || [];
      return list.length > 0 ? list : IMAGE_DEFAULT_RESOLUTIONS;
    }
    const list = getResolutionsForModel(capModel);
    return list.length > 0 ? list : VIDEO_DEFAULT_RESOLUTIONS;
  }, [kind, capModel]);

  const isVideo = kind === 'video';
  const btnSize = compact ? 'h-6 text-[11px] px-2' : 'h-7 text-xs px-2.5';
  const sectionClass = compact ? 'space-y-1.5' : 'space-y-2';
  const labelClass = compact ? 'text-xs' : 'text-sm font-medium';

  const resolutionButtonLabel = (r: string | number): string => {
    const s = String(r);
    if (!resolutionLabelWithDescription) return s;
    const desc = resolutionDescriptions?.[s];
    return desc ? `${s} ${desc}` : s;
  };

  return (
    <div className={groupClassName}>
      {/* Aspect ratio */}
      <div className={sectionClass}>
        <Label className={labelClass}>宽高比</Label>
        <div className="flex flex-wrap gap-1.5">
          {aspectRatios.map((ratio) => (
            <Button
              key={ratio}
              variant={aspectRatio === ratio ? 'default' : 'outline'}
              size="sm"
              className={btnSize}
              onClick={() => onAspectRatioChange(ratio)}
              title={aspectRatioDescriptions?.[ratio]}
            >
              {ratio}
            </Button>
          ))}
        </div>
      </div>

      {/* Resolution */}
      {isVideo ? (
        <div className={sectionClass}>
          <Label className={labelClass}>分辨率</Label>
          <div className="flex flex-wrap gap-1.5">
            {resolutions.map((r) => (
              <Button
                key={String(r)}
                variant={resolution === String(r) ? 'default' : 'outline'}
                size="sm"
                className={btnSize}
                onClick={() => onResolutionChange(String(r))}
                title={resolutionDescriptions?.[String(r)]}
              >
                {resolutionButtonLabel(r)}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className={sectionClass}>
          <Label className={labelClass}>分辨率</Label>
          <Select value={resolution || ''} onValueChange={onResolutionChange}>
            <SelectTrigger className={compact ? 'h-8' : 'h-9'}>
              <SelectValue placeholder="选择分辨率（可选）" />
            </SelectTrigger>
            <SelectContent>
              {resolutions.map((r) => (
                <SelectItem key={String(r)} value={String(r)}>
                  {String(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Duration (video only) */}
      {isVideo && duration !== undefined && onDurationChange && (
        <div className={sectionClass}>
          <Label className={labelClass}>视频时长 (秒)</Label>
          <div className={`flex items-center ${compact ? 'gap-2' : 'gap-3'}`}>
            <span className={`shrink-0 text-muted-foreground ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
              {durationMin}s
            </span>
            <Slider
              min={durationMin}
              max={durationMax}
              step={1}
              value={[Math.max(durationMin, Math.min(durationMax, duration ?? durationMin))]}
              onValueChange={([v]) => onDurationChange(v)}
              className="flex-1"
            />
            <span className={`shrink-0 text-muted-foreground ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
              {durationMax}s
            </span>
            {compact ? (
              <span className="w-9 shrink-0 rounded border border-input bg-background px-1 py-0.5 text-center text-[11px] tabular-nums">
                {duration ?? durationMin}
              </span>
            ) : (
              <Input
                type="number"
                min={durationMin}
                max={durationMax}
                value={duration ?? durationMin}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isNaN(v)) {
                    onDurationChange(Math.max(durationMin, Math.min(durationMax, v)));
                  }
                }}
                className="w-14 h-7 text-xs text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
