// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AIAssistPanel } from '../AIAssistPanel';

// jsdom does not implement scrollIntoView; AIAssistPanel calls it on mount.
if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// ── Mocks ────────────────────────────────────────────────────────────────

const requestAIMock = vi.fn();
vi.mock('@/lib/blueprint/ai-assist', () => ({
  requestAIAssist: (...args: unknown[]) => requestAIMock(...(args as [Record<string, unknown>])),
}));

const listSkillsMock = vi.fn();
const subscribeSkillsMock = vi.fn((_cb: (skills: unknown[]) => void) => () => {});
vi.mock('@/lib/skills/skill-library', () => ({
  listSkills: () => listSkillsMock(),
  subscribeSkills: (cb: (skills: unknown[]) => void) => subscribeSkillsMock(cb),
}));

// ── Helpers ──────────────────────────────────────────────────────────────

const TEST_SKILLS = [
  {
    name: 'sd2-pe',
    description: 'Seedance 2.0 prompt optimizer',
    filePath: 'C:\\skills\\seedance_SKILL.md',
    content: '---\nname: "sd2-pe"\n---\n\nbody',
  },
  {
    name: 'story-writer',
    description: 'Story structure helper',
    filePath: 'C:\\skills\\story.md',
    content: '---\nname: "story-writer"\n---\n\nbody',
  },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof AIAssistPanel>> = {}) {
  const onSkillRefsChange = vi.fn();
  const utils = render(
    <AIAssistPanel
      currentText="原始文本"
      role="prompt"
      language="auto"
      onSkillRefsChange={onSkillRefsChange}
      onApplyText={() => {}}
      onClose={() => {}}
      {...overrides}
    />,
  );
  return { ...utils, onSkillRefsChange };
}

async function findSkillChips() {
  return waitFor(() => {
    const chips = screen.getByTestId('skill-chips');
    expect(chips).toBeTruthy();
    return chips;
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('AIAssistPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSkillsMock.mockResolvedValue(TEST_SKILLS);
    requestAIMock.mockResolvedValue({ response: '好的', proposedText: undefined });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders skill chips for available skills (with description tooltips)', async () => {
    renderPanel({ skillRefs: [] });
    const chips = await findSkillChips();
    expect(screen.getByTestId('skill-chip-sd2-pe')).toBeTruthy();
    expect(screen.getByTestId('skill-chip-story-writer')).toBeTruthy();
    const chip = screen.getByTestId('skill-chip-sd2-pe') as HTMLElement;
    expect(chip.title).toBe('Seedance 2.0 prompt optimizer');
    expect(chips.textContent).toContain('装载技能');
  });

  it('highlights loaded skills and toggles via onSkillRefsChange', async () => {
    const { onSkillRefsChange } = renderPanel({ skillRefs: ['sd2-pe'] });
    await findSkillChips();

    const activeChip = screen.getByTestId('skill-chip-sd2-pe') as HTMLElement;
    expect(activeChip.getAttribute('aria-pressed')).toBe('true');
    expect(activeChip.textContent).toContain('✓');

    // Toggle off
    fireEvent.click(activeChip);
    expect(onSkillRefsChange).toHaveBeenCalledWith([]);

    // Toggle on (story-writer not yet loaded)
    const inactiveChip = screen.getByTestId('skill-chip-story-writer') as HTMLElement;
    expect(inactiveChip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(inactiveChip);
    expect(onSkillRefsChange).toHaveBeenCalledWith(['sd2-pe', 'story-writer']);
  });

  it('renders no skill chip section when the library is empty', async () => {
    listSkillsMock.mockResolvedValue([]);
    renderPanel({ skillRefs: [] });
    // Wait for the empty list to load
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalled());
    expect(screen.queryByTestId('skill-chips')).toBeNull();
  });

  it('renders no skill chip section when onSkillRefsChange is not provided', async () => {
    renderPanel({ onSkillRefsChange: undefined });
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalled());
    expect(screen.queryByTestId('skill-chips')).toBeNull();
  });

  it('sends the request with the loaded skillRefs', async () => {
    requestAIMock.mockResolvedValue({ response: '已修改' });
    renderPanel({ skillRefs: ['sd2-pe'] });
    await findSkillChips();

    const textarea = screen.getByPlaceholderText('输入修改指令… (Enter 发送)');
    fireEvent.change(textarea, { target: { value: '优化一下' } });
    fireEvent.click(screen.getByText('发送'));

    await waitFor(() => expect(requestAIMock).toHaveBeenCalledTimes(1));
    const req = requestAIMock.mock.calls[0][0];
    expect(req.skillRefs).toEqual(['sd2-pe']);
  });

  it('omits skillRefs in the request when no skill is loaded', async () => {
    requestAIMock.mockResolvedValue({ response: '已修改' });
    renderPanel({ skillRefs: [] });
    await findSkillChips();

    const textarea = screen.getByPlaceholderText('输入修改指令… (Enter 发送)');
    fireEvent.change(textarea, { target: { value: '优化一下' } });
    fireEvent.click(screen.getByText('发送'));

    await waitFor(() => expect(requestAIMock).toHaveBeenCalledTimes(1));
    const req = requestAIMock.mock.calls[0][0];
    expect(req.skillRefs).toBeUndefined();
  });

  it('keeps the loaded state stable across multiple toggles', async () => {
    const { onSkillRefsChange, rerender } = renderPanel({ skillRefs: ['sd2-pe'] });
    await findSkillChips();

    fireEvent.click(screen.getByTestId('skill-chip-story-writer'));
    expect(onSkillRefsChange).toHaveBeenLastCalledWith(['sd2-pe', 'story-writer']);

    // Simulate the parent applying updated refs (re-render with new props)
    rerender(
      <AIAssistPanel
        currentText="原始文本"
        role="prompt"
        language="auto"
        skillRefs={['sd2-pe', 'story-writer']}
        onSkillRefsChange={onSkillRefsChange}
        onApplyText={() => {}}
        onClose={() => {}}
      />,
    );
    const bothActive = screen.getByTestId('skill-chip-story-writer') as HTMLElement;
    expect(bothActive.getAttribute('aria-pressed')).toBe('true');

    // Un-toggle story-writer — parent receives the removal
    fireEvent.click(bothActive);
    expect(onSkillRefsChange).toHaveBeenLastCalledWith(['sd2-pe']);
  });

  it('updates available skills when the skill library changes (subscribe)', async () => {
    let notify: ((skills: typeof TEST_SKILLS) => void) | undefined;
    subscribeSkillsMock.mockImplementation((cb: (skills: unknown[]) => void) => {
      notify = cb as (skills: typeof TEST_SKILLS) => void;
      return () => {};
    });
    listSkillsMock.mockResolvedValue([]);

    renderPanel({ skillRefs: [] });
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalled());
    expect(screen.queryByTestId('skill-chips')).toBeNull();

    // Simulate a library refresh with skills now available
    expect(notify).toBeDefined();
    notify!(TEST_SKILLS);
    await findSkillChips();
  });

  it('shows error text when the AI request fails', async () => {
    requestAIMock.mockRejectedValue(new Error('网络错误'));
    renderPanel({ skillRefs: [] });
    await findSkillChips();

    const textarea = screen.getByPlaceholderText('输入修改指令… (Enter 发送)');
    fireEvent.change(textarea, { target: { value: '优化一下' } });
    fireEvent.click(screen.getByText('发送'));

    await waitFor(() =>
      expect(screen.getByText(/网络错误/)).toBeTruthy(),
    );
  });
});
