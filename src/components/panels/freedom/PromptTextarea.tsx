// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { useEffect, useState, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
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
  /** 防抖回写到 onChange 的毫秒数；默认 250ms。设为 0 则同步回写。 */
  debounceMs?: number;
}

export interface PromptTextareaRef {
  /** 在光标位置插入文本 */
  insertAtCursor: (text: string) => void;
}

/**
 * 带"放大编辑"按钮的描述文字输入框。
 * 适用于自由生成页面（图片/视频），文字较多时点击右上角按钮可在大窗口中编辑。
 *
 * 性能优化：内部维护一个本地 `inputValue` 镜像，所有按键先更新本地（即时反馈），
 * 然后通过防抖（默认 250ms）才回写到父组件的 `onChange`。这样可避免每次按键
 * 都触发 zustand persist 中间件的同步 stringify + 文件 IO 写入，导致输入卡顿。
 */
export const PromptTextarea = forwardRef<PromptTextareaRef, PromptTextareaProps>(
  function PromptTextarea(
    {
      value,
      onChange,
      placeholder,
      className = 'min-h-[120px] resize-none',
      expandTitle = '编辑描述文字',
      disabled,
      debounceMs = 250,
    },
    ref,
  ) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(value);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // —— 本地输入镜像（用于消除每键写盘卡顿）——
    const [inputValue, setInputValue] = useState(value);
    /** 标记当前 inputValue 是否是用户正在编辑（尚未 flush 到外部）。 */
    const dirtyRef = useRef(false);
    /** 待 flush 的最新文本（即 inputValue 的同步副本，避免闭包陈旧）。 */
    const pendingValueRef = useRef(value);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onChangeRef = useRef(onChange);
    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    const flushNow = useCallback(() => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        // 仅在确实变化时才触发外部 setState
        onChangeRef.current(pendingValueRef.current);
      }
    }, []);

    // 外部 value 变化时（如：历史回填、放大对话框"应用"、清空等），同步到本地。
    // 仅在用户没有正在输入（无 pending）时同步，避免把用户当前输入覆盖掉。
    useEffect(() => {
      if (!dirtyRef.current && value !== inputValue) {
        setInputValue(value);
        pendingValueRef.current = value;
      }
    }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

    // 卸载时确保 flush（避免输入丢失）
    useEffect(() => {
      return () => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        if (dirtyRef.current) {
          onChangeRef.current(pendingValueRef.current);
        }
      };
    }, []);

    const handleLocalChange = useCallback((next: string) => {
      pendingValueRef.current = next;
      dirtyRef.current = true;
      setInputValue(next);
      if (debounceMs <= 0) {
        // 同步回写
        dirtyRef.current = false;
        onChangeRef.current(next);
        return;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (dirtyRef.current) {
          dirtyRef.current = false;
          onChangeRef.current(pendingValueRef.current);
        }
      }, debounceMs);
    }, [debounceMs]);

    // 打开放大对话框时先 flush 一次，确保 draft 拿到最新文本
    useEffect(() => {
      if (open) {
        flushNow();
        setDraft(pendingValueRef.current);
      }
    }, [open, flushNow]);

    const charCount = inputValue.length;

    useImperativeHandle(ref, () => ({
      insertAtCursor: (text: string) => {
        // 先 flush 待写的本地值，保证基于"最新文本"插入
        flushNow();
        const current = pendingValueRef.current;
        const textarea = textareaRef.current;
        if (!textarea) {
          // 回退：末尾追加
          const sep = current.length > 0 && !current.endsWith(' ') && !current.endsWith('\n') ? ' ' : '';
          const newValue = `${current}${sep}${text} `;
          pendingValueRef.current = newValue;
          dirtyRef.current = false;
          setInputValue(newValue);
          onChangeRef.current(newValue);
          return;
        }
        const start = textarea.selectionStart ?? current.length;
        const end = textarea.selectionEnd ?? current.length;
        const before = current.slice(0, start);
        const after = current.slice(end);
        const sep = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : '';
        const newValue = `${before}${sep}${text} ${after}`;
        pendingValueRef.current = newValue;
        dirtyRef.current = false;
        setInputValue(newValue);
        onChangeRef.current(newValue);
        // 恢复光标到插入文本后
        setTimeout(() => {
          const newPos = start + sep.length + text.length + 1;
          textarea.setSelectionRange(newPos, newPos);
          textarea.focus();
        }, 0);
      },
    }), [flushNow]);

    return (
      <div className="relative">
        <Textarea
          ref={textareaRef}
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => handleLocalChange(e.target.value)}
          onBlur={flushNow}
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
                    setDraft(pendingValueRef.current);
                    setOpen(false);
                  }}
                >
                  <X className="mr-1.5 h-4 w-4" /> 取消
                </Button>
                <Button
                  onClick={() => {
                    // 应用：更新本地镜像并立即 flush 到外部
                    pendingValueRef.current = draft;
                    dirtyRef.current = false;
                    setInputValue(draft);
                    onChangeRef.current(draft);
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
  },
);
