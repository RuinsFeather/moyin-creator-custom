// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Blueprint Onboarding Tutorial (§11.3)
//
// First-use guide showing the minimal workflow (P1-12, 三步引导):
//   add a text box → connect it to an image box → click generate
//
// Features:
//   - Step-by-step overlay with highlights
//   - Skip button to dismiss
//   - Persists dismissal in localStorage
//   - Auto-shows on first visit to blueprint view

import { useState, useCallback, useEffect, memo } from 'react';
import { useBlueprintStore } from '@/stores/blueprint-store';

// ── Persistence ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'blueprint-onboarding-dismissed';

function isDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function dismiss(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // localStorage unavailable — ignore
  }
}

// ── Tutorial steps ───────────────────────────────────────────────────────

interface TutorialStep {
  title: string;
  description: string;
  icon: string;
  highlight?: string; // CSS selector to highlight (optional)
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: '第一步：添加文本框',
    description: '点击工具栏的「＋ 添加窗口」按钮，选择「文本框」。在这里填写你的创意提示词。',
    icon: '📝',
    highlight: '[data-testid="add-node-menu"]',
  },
  {
    title: '第二步：连到图片框',
    description: '添加一个「图片框」，并从文本框拖拽连线到图片框的输入端口，建立数据流。',
    icon: '🎨',
  },
  {
    title: '第三步：点生成',
    description: '点击图片框上的生成按钮，引擎会自动执行上游的文本框，然后生成图片。',
    icon: '▶️',
  },
];

// ── Component ────────────────────────────────────────────────────────────

export const BlueprintOnboarding = memo(function BlueprintOnboarding() {
  const [visible, setVisible] = useState(() => !isDismissed());
  const [step, setStep] = useState(0);

  const handleNext = useCallback(() => {
    if (step < TUTORIAL_STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
      setVisible(false);
    }
  }, [step]);

  const handleSkip = useCallback(() => {
    dismiss();
    setVisible(false);
  }, []);

  const handlePrev = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  // Auto-hide if no active project is open (P1-12: no longer depends on beginnerMode)
  const activeProjectId = useBlueprintStore((s) => s.activeProjectId);
  useEffect(() => {
    if (!activeProjectId) setVisible(false);
  }, [activeProjectId]);

  if (!visible) return null;

  const current = TUTORIAL_STEPS[step];
  const isLast = step === TUTORIAL_STEPS.length - 1;
  const isFirst = step === 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div className="mx-4 w-full max-w-md rounded-xl border bg-popover p-6 shadow-2xl">
        {/* Progress dots */}
        <div className="mb-4 flex items-center justify-center gap-1.5">
          {TUTORIAL_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-primary' : i < step ? 'w-1.5 bg-primary/50' : 'w-1.5 bg-muted'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="mb-6 text-center">
          <div className="mb-2 text-3xl">{current.icon}</div>
          <h2 className="mb-2 text-lg font-semibold text-foreground">{current.title}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{current.description}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          {isFirst ? (
            <button
              onClick={handleSkip}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              跳过教程
            </button>
          ) : (
            <button
              onClick={handlePrev}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              ← 上一步
            </button>
          )}

          <button
            onClick={handleNext}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {isLast ? '开始使用' : '下一步 →'}
          </button>
        </div>
      </div>
    </div>
  );
});
