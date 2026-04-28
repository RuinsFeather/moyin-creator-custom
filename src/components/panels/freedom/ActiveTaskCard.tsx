"use client";

import { Loader2, StopCircle, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { ActiveTask } from '@/stores/freedom-store';

interface ActiveTaskCardProps {
  task: ActiveTask;
  selected?: boolean;
  onSelect?: () => void;
  onCancel?: () => void;
  onDismiss?: () => void;
}

/**
 * 进行中 / 已完成的任务小窗，显示在历史栏顶部。
 * 点击卡片可在主预览区查看进度；运行中可取消，结束后可关闭。
 */
export function ActiveTaskCard({ task, selected, onSelect, onCancel, onDismiss }: ActiveTaskCardProps) {
  const running = task.status === 'running' || task.status === 'cancelling';
  const isError = task.status === 'error';
  const isDone = task.status === 'done';
  const isCancelled = task.status === 'cancelled';

  return (
    <div
      role="button"
      onClick={onSelect}
      className={cn(
        'group relative rounded-lg border bg-card overflow-hidden cursor-pointer transition-colors',
        selected ? 'border-primary ring-1 ring-primary/40' : 'hover:border-primary/50',
      )}
    >
      <div className="flex gap-2 p-2">
        {/* 缩略：参考图或生成结果 */}
        <div className="flex-shrink-0 w-14 h-14 rounded-md bg-muted overflow-hidden flex items-center justify-center">
          {task.resultUrl ? (
            <img src={task.resultUrl} alt="" className="w-full h-full object-cover" />
          ) : task.thumbnailUrl ? (
            <img src={task.thumbnailUrl} alt="" className="w-full h-full object-cover opacity-70" />
          ) : running ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : isError ? (
            <AlertCircle className="h-5 w-5 text-destructive" />
          ) : isCancelled ? (
            <X className="h-5 w-5 text-muted-foreground" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          )}
        </div>

        {/* 文本信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              'inline-block w-1.5 h-1.5 rounded-full',
              running ? 'bg-primary animate-pulse' :
              isDone ? 'bg-emerald-500' :
              isError ? 'bg-destructive' :
              'bg-muted-foreground',
            )} />
            <span className="text-[11px] font-medium truncate">
              {running ? `生成中 ${task.percent}%` :
               isDone ? '已完成' :
               isError ? '失败' :
               isCancelled ? '已取消' : '取消中…'}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
            {task.prompt}
          </p>
          <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
            {task.model}
          </p>
        </div>
      </div>

      {/* 进度条 */}
      {running && (
        <div className="px-2 pb-2 space-y-1">
          <Progress value={task.percent} className="h-1" />
          <p className="text-[10px] text-muted-foreground truncate">{task.message}</p>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {running && onCancel && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 bg-black/60 hover:bg-destructive text-white"
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            disabled={task.status === 'cancelling'}
            title="取消任务"
          >
            <StopCircle className="h-3.5 w-3.5" />
          </Button>
        )}
        {!running && onDismiss && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 bg-black/60 hover:bg-black/80 text-white"
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            title="关闭"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
