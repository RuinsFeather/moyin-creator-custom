// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { useEffect, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface PromptTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 普通模式下输入框的 className */
  className?: string;
  /** 放大对话框的标题 */
  expandTitle?: string;
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * 带"放大编辑"按钮的描述文字输入框。
 * 适用于自由生成页面（图片/视频/电影），文字较多时点击右上角按钮可在大窗口中编辑。
 */
export function PromptTextarea({
  value,
  onChange,
  placeholder,
  className = 'min-h-[120px] resize-none',
  expandTitle = '编辑描述文字',
  disabled,
}: PromptTextareaProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  // 打开时同步当前值到草稿
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const charCount = value.length;

  return (
    <div className="relative">
      <Textarea
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${className} pr-10`}
        disabled={disabled}
      />
      {/* 放大按钮（右上角悬浮） */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1.5 top-1.5 h-7 w-7 opacity-70 hover:opacity-100"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title="放大编辑"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>

      {/* 字数提示（≥0 时一直显示，但超过 80 才显眼） */}
      {charCount > 0 && (
        <div className="absolute bottom-1.5 right-2 text-[10px] text-muted-foreground pointer-events-none select-none">
          {charCount}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="!max-w-[min(900px,90vw)] w-[min(900px,90vw)] h-[min(80vh,720px)] flex flex-col gap-4 p-6"
        >
          <DialogHeader>
            <DialogTitle>{expandTitle}</DialogTitle>
            <DialogDescription className="text-xs">
              支持多行编辑，关闭或点击"应用"后回写到原输入框。
            </DialogDescription>
          </DialogHeader>

          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="flex-1 min-h-0 resize-none text-sm leading-relaxed"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{draft.length} 字</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(value);
                  setOpen(false);
                }}
              >
                <X className="mr-1.5 h-4 w-4" /> 取消
              </Button>
              <Button
                onClick={() => {
                  onChange(draft);
                  setOpen(false);
                }}
              >
                应用
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
