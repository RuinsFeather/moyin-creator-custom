import { readImageAsBase64 } from '@/lib/image-storage';

async function downloadFreedomFile(url: string): Promise<Blob> {
  if (!url) throw new Error('Empty URL');

  if (url.startsWith('local-image://')) {
    const base64 = await readImageAsBase64(url);
    if (!base64) throw new Error(`Failed to read local file: ${url}`);
    const response = await fetch(base64);
    return response.blob();
  }

  if (url.startsWith('data:')) {
    const response = await fetch(url);
    return response.blob();
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }
  return response.blob();
}

function triggerFreedomDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

export async function saveFreedomMedia(url: string, filename: string): Promise<void> {
  const blob = await downloadFreedomFile(url);
  triggerFreedomDownload(blob, filename);
}
