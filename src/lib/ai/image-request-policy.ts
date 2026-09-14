// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

const REFERENCE_IMAGE_FIELDS = ['image', 'images', 'image_urls', 'reference_images'] as const;

/**
 * OpenAI-compatible GPT Image generation endpoints accept JSON text-to-image
 * parameters only. Reference images require a separate edits/multipart API.
 */
export function isStrictGptImageGenerationRequest(model: string | undefined, submitPath: string): boolean {
  return /^gpt[-_]?(?:image|img)/i.test(model || '')
    && /\/images\/generations\/?(?:\?.*)?$/i.test(submitPath);
}

/** Remove guessed reference-image aliases that strict generation APIs reject. */
export function sanitizeImageGenerationJsonBody<T extends Record<string, unknown>>(
  body: T,
  model: string | undefined,
  submitPath: string,
): T {
  if (!isStrictGptImageGenerationRequest(model, submitPath)) return body;

  for (const field of REFERENCE_IMAGE_FIELDS) {
    delete body[field];
  }
  return body;
}