// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Blueprint Onboarding Tutorial (§11.3)
//
// First-use guide showing the minimal workflow:
//   text input → image generator → output
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
    title: '欢迎使用蓝图编辑器',
    description: '蓝图是一个可视化的 AI 内容生成流水线。通过连接不同的节点，你可以定义从文本到图片、视频的完整生成流程。',
    icon: '🎬',
  },
  {
    title: '第一步：添加文本输入',
    description: '点击工具栏的「＋ 添加节点」按钮，选择「文本输入」节点。在这里填写你的创意提示词。',
    icon: '📝',
    highlight: '[data-testid="add-node-menu"]',
  },
  {
    title: '第二步：添加图片生成器',
    description: '添加一个「图片生成器」节点。它会根据上游的文本提示词，调用 AI 生成图片。',
    icon: '🎨',
  },
  {
    title: '第三步：连接节点',
    description: '从文本节点的输出端口拖拽连线到图片生成器的输入端口，建立数据流。',
    icon: '🔗',
  },
  {
    title: '第四步：运行生成',
    description: '选中图片生成器节点，点击工具栏的「▶ 选中」按钮运行。引擎会自动执行上游的文本节点，然后生成图片。',
    icon: '▶️',
  },
  {
    title: '开始创作！',
    description: '你还可以添加「输出」节点来保存结果，或添加更多生成器构建复杂流水线。随时点击「▶▶ 全部」运行整条链路。',
    icon: '🚀',
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

  // Auto-hide if no active project or not in beginner mode (§11.3.2)
  const activeProjectId = useBlueprintStore((s) => s.activeProjectId);
  const beginnerMode = useBlueprintStore((s) => s.beginnerMode);
  useEffect(() => {
    if (!activeProjectId || !beginnerMode) setVisible(false);
  }, [activeProjectId, beginnerMode]);

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
