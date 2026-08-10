// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// §12.4 蓝图版本号与软件版本同步 —— schema-version 派生逻辑测试。
//
// 覆盖：
//   - 标准 semver（major.minor.patch）正确派生整数
//   - 带 build 后缀（-N）正确派生
//   - 非法输入回退 0，不会抛异常
//   - 版本递增是单调的（发版必然导致 schema 版本变化）

import { describe, expect, it } from 'vitest';
import {
  blueprintSchemaVersionFromAppVersion,
  BLUEPRINT_SCHEMA_VERSION,
} from '../schema-version';
import packageJson from '../../../../package.json';

describe('blueprintSchemaVersionFromAppVersion', () => {
  it('0.4.0-2 → 4002（与当前软件版本一致）', () => {
    expect(blueprintSchemaVersionFromAppVersion('0.4.0-2')).toBe(4002);
  });

  it('0.4.0 → 4000（无 build 后缀时 build 为 0）', () => {
    expect(blueprintSchemaVersionFromAppVersion('0.4.0')).toBe(4000);
  });

  it('1.2.3-4 → 102034（major*100000 + minor*1000 + patch*10 + build）', () => {
    expect(blueprintSchemaVersionFromAppVersion('1.2.3-4')).toBe(102034);
  });

  it('0.5.0-0 → 5000（minor 递增）', () => {
    expect(blueprintSchemaVersionFromAppVersion('0.5.0-0')).toBe(5000);
  });

  it('patch 版本变化也会改变 schema 版本（0.4.0-2 → 0.4.1-2 递增）', () => {
    expect(blueprintSchemaVersionFromAppVersion('0.4.1-2')).toBe(4012);
    expect(blueprintSchemaVersionFromAppVersion('0.4.1-2')).toBeGreaterThan(
      blueprintSchemaVersionFromAppVersion('0.4.0-2'),
    );
  });

  it('非法版本回退 0 且不抛异常', () => {
    expect(blueprintSchemaVersionFromAppVersion('')).toBe(0);
    expect(blueprintSchemaVersionFromAppVersion('not-a-version')).toBe(0);
    // 缺 minor/patch 时按 0 补齐：1.2 → 1.2.0 → 102000
    expect(blueprintSchemaVersionFromAppVersion('1.2')).toBe(102000);
  });

  it('当前导出的 BLUEPRINT_SCHEMA_VERSION 与 package.json version 同步', () => {
    expect(BLUEPRINT_SCHEMA_VERSION).toBe(
      blueprintSchemaVersionFromAppVersion(packageJson.version),
    );
    // 当前软件版本 0.4.0-2 → 4002
    expect(BLUEPRINT_SCHEMA_VERSION).toBe(4002);
  });
});
