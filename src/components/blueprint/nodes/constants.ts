// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Constants for image generator node configuration.
 * Derived from FreedomImageParams and the freedom API routes.
 */

export const IMAGE_MODELS = [
  { value: 'sd-xl', label: 'SD-XL' },
  { value: 'flux-schnell', label: 'Flux Schnell' },
  { value: 'flux-pro', label: 'Flux Pro' },
  { value: 'midjourney', label: 'Midjourney' },
  { value: 'ideogram', label: 'Ideogram' },
] as const;

export const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
] as const;

export const RESOLUTIONS = [
  { value: '512x512', label: '512×512' },
  { value: '768x768', label: '768×768' },
  { value: '1024x1024', label: '1024×1024' },
  { value: '1024x768', label: '1024×768' },
  { value: '768x1024', label: '768×1024' },
  { value: '1216x832', label: '1216×832' },
  { value: '832x1216', label: '832×1216' },
] as const;
