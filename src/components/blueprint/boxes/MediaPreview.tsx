// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// MediaPreview — image full display / video poster-frame + click-to-play.
// P1-2.

import { memo, useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface ImagePreviewProps {
  url: string;
  alt?: string;
  className?: string;
}

/** Full image preview (object-contain, fills its container). */
function ImagePreviewComponent({ url, alt, className }: ImagePreviewProps) {
  return (
    <div className={cn('flex items-center justify-center overflow-hidden rounded bg-muted/30', className)}>
      <img src={url} alt={alt ?? '图片预览'} className="h-full w-full object-contain" />
    </div>
  );
}

export const ImagePreview = memo(ImagePreviewComponent);

export interface VideoPreviewProps {
  url: string;
  className?: string;
}

/**
 * Video poster-frame preview. Shows the first frame (muted, no autoplay);
 * clicking toggles play/pause. While playing, native controls are shown
 * for pause/mute/fullscreen.
 */
function VideoPreviewComponent({ url, className }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {
        // Autoplay/play failures fall back to native controls only.
      });
    } else {
      video.pause();
    }
  }, []);

  return (
    <div
      className={cn(
        'nodrag relative flex items-center justify-center overflow-hidden rounded bg-black/80',
        className,
      )}
      onClick={handleToggle}
    >
      <video
        ref={videoRef}
        src={url}
        preload="metadata"
        muted
        playsInline
        controls={isPlaying}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        className="h-full w-full object-contain"
      />
      {!isPlaying && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white">
            ▶
          </div>
        </div>
      )}
    </div>
  );
}

export const VideoPreview = memo(VideoPreviewComponent);
