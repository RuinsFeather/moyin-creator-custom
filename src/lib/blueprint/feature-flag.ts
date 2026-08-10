// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Central blueprint feature flag.
 * Disabled by default so unfinished blueprint UI cannot affect existing workflows.
 */
export const isBlueprintFeatureEnabled = (): boolean =>
  import.meta.env.VITE_ENABLE_BLUEPRINT === 'true';
