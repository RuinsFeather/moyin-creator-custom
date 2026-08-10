// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

function normalizeForComparison(model: string): string {
  return model.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

/**
 * Convert provider catalogue/display names to request model IDs.
 * Keep these rules narrow: version suffixes can be meaningful for other models.
 */
export function resolveRequestModel(model: string): string {
  const trimmed = model.trim();
  const normalized = normalizeForComparison(trimmed);
  const deepSeekV4 = normalized.match(/^deepseek-v4-(pro|flash)(?:-\d{4,8})?$/);
  if (deepSeekV4) return `deepseek-v4-${deepSeekV4[1]}`;
  return trimmed;
}

/** Extract a compatible model ID when an OpenAI-compatible gateway advertises it in a 400 error. */
export function resolveSupportedModelFromError(errorText: string, requestedModel: string): string | null {
  const match = errorText.match(/supported API model names? (?:are|is) ([^".]+?)(?:,?\s*but you passed|[.;]|$)/i);
  if (!match) return null;

  const candidates = match[1]
    .split(/\s*(?:,|\bor\b|\band\b)\s*/i)
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  if (candidates.length === 0) return null;

  const requested = normalizeForComparison(resolveRequestModel(requestedModel));
  return candidates.find((candidate) => normalizeForComparison(candidate) === requested)
    ?? candidates.find((candidate) => {
      const normalized = normalizeForComparison(candidate);
      return requested.startsWith(normalized) || normalized.startsWith(requested);
    })
    ?? null;
}