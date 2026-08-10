// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// 蓝图 schema 版本号 —— 与软件版本同步，不单独维护一套版本号。
//
// 设计动机（§12.4）：
//   蓝图持久化需要版本号来驱动 zustand persist 的 migrate 流程。但蓝图是
//   软件的一部分，其 schema 变更始终伴随软件发版，因此不值得维护一套独立
//   递增的蓝图版本号（容易与软件版本脱节、漏更）。
//
// 方案：从软件版本号派生一个单调递增的整数。
//   `major.minor.patch-build` → `major*100000 + minor*1000 + patch*10 + build`
//   例：0.4.0-2 → 4002，0.4.1-0 → 4010，0.5.0-0 → 50000。
//
//   这样每次软件发版（版本号变化）蓝图的 schema 版本都会随之改变，
//   zustand persist 检测到版本不匹配后自动调用 migrate 完成防御性规范化。

import packageJson from '../../../package.json';

/**
 * 从软件版本字符串派生蓝图 schema 版本整数。
 * 解析失败时回退到 0（migrate 会把旧数据防御性规范化到当前版本）。
 */
export function blueprintSchemaVersionFromAppVersion(
  appVersion: string,
): number {
  const [semver, buildRaw] = appVersion.split('-');
  const parts = semver.split('.').map((n) => parseInt(n, 10));
  const major = Number.isFinite(parts[0]) ? (parts[0] as number) : 0;
  const minor = Number.isFinite(parts[1]) ? (parts[1] as number) : 0;
  const patch = Number.isFinite(parts[2]) ? (parts[2] as number) : 0;
  const build = Number.isFinite(parseInt(buildRaw, 10))
    ? (parseInt(buildRaw, 10) as number)
    : 0;
  return major * 100000 + minor * 1000 + patch * 10 + build;
}

/** 当前蓝图 schema 版本号（与软件版本同步派生）。 */
export const BLUEPRINT_SCHEMA_VERSION =
  blueprintSchemaVersionFromAppVersion(packageJson.version);