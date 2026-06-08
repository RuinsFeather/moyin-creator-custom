import { readImageAsBase64, saveImageToLocal } from '@/lib/image-storage';

function getFileExtension(filename: string): string {
  const match = filename.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() || 'png';
}

function getImageFilters(filename: string) {
  const ext = getFileExtension(filename);
  const extensions = Array.from(new Set([ext, 'png', 'jpg', 'jpeg', 'webp', 'gif']));
  return [{ name: 'Image', extensions }];
}

async function saveWithElectronDialog(url: string, filename: string): Promise<boolean> {
  if (typeof window === 'undefined' || !window.electronAPI?.saveFileDialog) {
    return false;
  }

  let localPath = url;
  if (!url.startsWith('local-image://') && !url.startsWith('local-video://') && !url.startsWith('file://')) {
    localPath = await saveImageToLocal(url, 'shots', filename);
  }

  if (!localPath || localPath === url || !localPath.startsWith('local-image://')) {
    return false;
  }

  const result = await window.electronAPI.saveFileDialog({
    localPath,
    defaultPath: filename,
    filters: getImageFilters(filename),
  });

  if (result.canceled) return true;
  if (!result.success) throw new Error(result.error || 'Save dialog failed');
  return true;
}

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
  if (await saveWithElectronDialog(url, filename)) {
    return;
  }

  const blob = await downloadFreedomFile(url);
  triggerFreedomDownload(blob, filename);
}
