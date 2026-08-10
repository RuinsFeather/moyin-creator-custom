// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  mainNavItems,
  resolveTab,
  useMediaPanelStore,
} from '../media-panel-store';

describe('Freedom workspace navigation', () => {
  beforeEach(() => {
    useMediaPanelStore.setState({
      activeTab: 'dashboard',
      activeStage: 'script',
      inProject: false,
    });
  });

  it('opens freedom as its own primary stage', () => {
    expect(resolveTab('freedom')).toBe('freedom');

    useMediaPanelStore.getState().setActiveTab('freedom');

    expect(useMediaPanelStore.getState()).toMatchObject({
      activeTab: 'freedom',
      activeStage: 'freedom',
      inProject: true,
    });
  });

  it('uses freedom instead of project assets in primary navigation', () => {
    expect(mainNavItems.map((item) => item.id)).toContain('freedom');
    expect(mainNavItems.map((item) => item.id)).not.toContain('project-assets');
    expect(mainNavItems.at(-1)).toMatchObject({ id: 'freedom', label: '自由' });
  });

  it('keeps blueprint entry always visible in primary navigation', () => {
    const ids = mainNavItems.map((item) => item.id);
    expect(ids).toContain('blueprint');
    // 蓝图常驻侧边栏（§12.5——本版本不发布，无需功能开关）
    expect(mainNavItems.find((item) => item.id === 'blueprint')).toMatchObject({
      label: '蓝图',
      phase: '03',
    });
  });

  it('continues redirecting removed legacy asset tabs', () => {
    expect(resolveTab('media')).toBe('freedom');
    expect(resolveTab('export')).toBe('freedom');
    expect(resolveTab('assets')).toBe('freedom');
    expect(resolveTab('project-assets')).toBe('freedom');
  });

  it('opens freedom when restoring a persisted project-assets tab', () => {
    useMediaPanelStore.getState().setActiveTab('project-assets');

    expect(useMediaPanelStore.getState()).toMatchObject({
      activeTab: 'freedom',
      activeStage: 'freedom',
      inProject: true,
    });
  });
});