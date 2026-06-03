"use client";

import { useEffect, useState } from 'react';
import { Clock, VideoIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFreedomHistoryStore, type HistoryEntry } from '@/stores/freedom-history-store';
import { useMediaStore } from '@/stores/media-store';
import { cn } from '@/lib/utils';

/** 将毫秒数格式化为 "xx min xx s" 或 "xx s"（< 1min 时省略分钟） */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const totalSeconds = Math.round(ms / 1000);
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  if (min <= 0) return `${sec} s`;
  return `${min} min ${sec} s`;
}

interface GenerationHistoryProps {
  type: 'image' | 'video';
  onSelect?: (entry: HistoryEntry) => void;
  className?: string;
}

function HistoryThumbnail({ entry, resultUrl, thumbnailUrl }: { entry: HistoryEntry; resultUrl: string; thumbnailUrl?: string }) {
  const [loadFailed, setLoadFailed] = useState(false);
  const src = thumbnailUrl || resultUrl;

  useEffect(() => {
    setLoadFailed(false);
  }, [src]);

  if (!src || loadFailed) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        {entry.type === 'video' ? <VideoIcon className="h-8 w-8 opacity-50" /> : <Clock className="h-8 w-8 opacity-50" />}
      </div>
    );
  }

  if (entry.type === 'video') {
    return (
      <video
        src={src}
        className="w-full h-full object-cover"
        muted
        playsInline
        preload="metadata"
        onError={() => setLoadFailed(true)}
      />
    );
  }

  return (
    <img
      src={src}
      alt={entry.prompt}
      className="w-full h-full object-cover"
      loading="lazy"
      onError={() => setLoadFailed(true)}
    />
  );
}

export function GenerationHistory({ type, onSelect, className }: GenerationHistoryProps) {
  const { imageHistory, videoHistory, removeHistoryEntry, clearHistory } =
    useFreedomHistoryStore();
  const mediaFiles = useMediaStore((s) => s.mediaFiles);

  const history = type === 'image' ? imageHistory : videoHistory;

  if (history.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full text-muted-foreground', className)}>
        <Clock className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">暂无生成记录</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-medium">历史记录 ({history.length})</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground hover:text-destructive"
          onClick={() => clearHistory(type)}
        >
          清空
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {history.map((entry) => {
            const mediaFile = entry.mediaId
              ? mediaFiles.find((item) => item.id === entry.mediaId)
              : undefined;
            const resolvedResultUrl = mediaFile?.url || entry.resultUrl;
            const resolvedThumbnailUrl = mediaFile?.thumbnailUrl || entry.thumbnailUrl;
            const resolvedEntry = resolvedResultUrl === entry.resultUrl && resolvedThumbnailUrl === entry.thumbnailUrl
              ? entry
              : { ...entry, resultUrl: resolvedResultUrl, thumbnailUrl: resolvedThumbnailUrl };

            return (
              <div
                key={entry.id}
                className="group relative rounded-lg border bg-card overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => onSelect?.(resolvedEntry)}
              >
                {/* Thumbnail */}
                <div className="aspect-video w-full bg-muted overflow-hidden">
                  <HistoryThumbnail entry={entry} resultUrl={resolvedResultUrl} thumbnailUrl={resolvedThumbnailUrl} />
                </div>

                {/* Info */}
                <div className="p-2">
                  <p className="text-xs text-muted-foreground truncate">{entry.model}</p>
                  <p className="text-xs mt-0.5 line-clamp-2">{entry.prompt}</p>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    {typeof entry.durationMs === 'number' && entry.durationMs > 0 && (
                      <p className="text-[10px] text-muted-foreground shrink-0" title="本次生成耗时">
                        耗时：{formatDuration(entry.durationMs)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Delete button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 hover:bg-black/80 text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeHistoryEntry(entry.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
