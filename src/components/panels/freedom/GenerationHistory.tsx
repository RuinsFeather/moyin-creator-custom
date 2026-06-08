"use client";

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Copy, ImageIcon, Loader2, VideoIcon, X } from 'lucide-react';
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

const MAX_VISIBLE_HISTORY_ITEMS = 50;
const MAX_VIDEO_THUMBNAIL_ITEMS = 30;

function useNearViewport(rootMargin = '240px') {
  const ref = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry.isIntersecting),
      { rootMargin, threshold: 0.01 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, nearViewport };
}

const HistoryThumbnail = memo(function HistoryThumbnail({
  entry,
  resultUrl,
  thumbnailUrl,
  loadThumbnail = true,
}: {
  entry: HistoryEntry;
  resultUrl: string;
  thumbnailUrl?: string;
  loadThumbnail?: boolean;
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  const src = entry.type === 'video' ? resultUrl : thumbnailUrl || resultUrl;

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
    if (!loadThumbnail) {
      return (
        <div className="relative flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
          <VideoIcon className="h-8 w-8 opacity-50" />
          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">占位</span>
        </div>
      );
    }

    return (
      <LazyVideoThumbnail
        src={resultUrl}
        prompt={entry.prompt}
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
      decoding="async"
      onError={() => setLoadFailed(true)}
    />
  );
});

const LazyVideoThumbnail = memo(function LazyVideoThumbnail({
  src,
  prompt,
  onError,
}: {
  src: string;
  prompt: string;
  onError: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const { ref, nearViewport } = useNearViewport();

  useEffect(() => {
    setFrameReady(false);
  }, [src]);

  return (
    <div ref={ref} className="relative h-full w-full bg-muted">
      {nearViewport ? (
        <video
          ref={videoRef}
          src={src}
          aria-label={prompt}
          className="w-full h-full object-cover"
          muted
          playsInline
          preload="metadata"
          disablePictureInPicture
          disableRemotePlayback
          onLoadedData={(e) => {
            const video = e.currentTarget;
            if (!frameReady && Number.isFinite(video.duration) && video.duration > 0) {
              try {
                video.currentTime = Math.min(0.2, Math.max(0, video.duration * 0.05));
              } catch {
                // 某些远程视频在 metadata 阶段禁止 seek，保持首帧即可。
              }
            }
            setFrameReady(true);
          }}
          onSeeked={() => setFrameReady(true)}
          onError={onError}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <VideoIcon className="h-8 w-8 opacity-50" />
        </div>
      )}

      {!frameReady && nearViewport && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/80 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}

      <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">视频</span>
    </div>
  );
});

const HistoryItem = memo(function HistoryItem({
  entry,
  loadThumbnail,
  onSelect,
  onRemove,
}: {
  entry: HistoryEntry;
  loadThumbnail?: boolean;
  onSelect?: (entry: HistoryEntry) => void;
  onRemove: (id: string) => void;
}) {
  const mediaFiles = useMediaStore((s) => s.mediaFiles);
  const mediaFile = useMemo(
    () => (entry.mediaId ? mediaFiles.find((item) => item.id === entry.mediaId) : undefined),
    [entry.mediaId, mediaFiles],
  );
  const resolvedResultUrl = mediaFile?.url || entry.resultUrl;
  const resolvedThumbnailUrl = mediaFile?.thumbnailUrl || entry.thumbnailUrl;
  const resolvedEntry = resolvedResultUrl === entry.resultUrl && resolvedThumbnailUrl === entry.thumbnailUrl
    ? entry
    : { ...entry, resultUrl: resolvedResultUrl, thumbnailUrl: resolvedThumbnailUrl };

  const copyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = prompt;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  return (
    <div
      className="group relative rounded-lg border bg-card overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => onSelect?.(resolvedEntry)}
    >
      {/* Thumbnail */}
      <div className="aspect-video w-full bg-muted overflow-hidden">
        <HistoryThumbnail
          entry={entry}
          resultUrl={resolvedResultUrl}
          thumbnailUrl={resolvedThumbnailUrl}
          loadThumbnail={loadThumbnail}
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        title="复制提示词"
        className="absolute top-1 left-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 hover:bg-black/80 text-white"
        onClick={(e) => {
          e.stopPropagation();
          void copyPrompt(entry.prompt);
        }}
      >
        <Copy className="h-3 w-3" />
      </Button>

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
          onRemove(entry.id);
        }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
});

export function GenerationHistory({ type, onSelect, className }: GenerationHistoryProps) {
  const { imageHistory, videoHistory, removeHistoryEntry, clearHistory } =
    useFreedomHistoryStore();

  const history = type === 'image' ? imageHistory : videoHistory;
  const visibleHistory = type === 'video' ? history.slice(0, MAX_VISIBLE_HISTORY_ITEMS) : history;

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
          {visibleHistory.map((entry, index) => (
            <HistoryItem
              key={entry.id}
              entry={entry}
              loadThumbnail={type !== 'video' || index < MAX_VIDEO_THUMBNAIL_ITEMS}
              onSelect={onSelect}
              onRemove={removeHistoryEntry}
            />
          ))}
          {visibleHistory.length < history.length && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              <ImageIcon className="h-4 w-4 mb-1 opacity-50" />
              为保证视频播放器流畅，仅显示最近 {MAX_VISIBLE_HISTORY_ITEMS} 条历史。
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
