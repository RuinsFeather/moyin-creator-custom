// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Vitest setup file — provides browser-like storage mocks for the Node test
 * environment (§12.1 item 3: storage / Zustand mock boundaries).
 *
 * Without this, zustand `persist` middleware throws inside its internal
 * `setItem` when calling `localStorage` in Node, producing noisy stack
 * traces even though the error is swallowed by zustand.
 *
 * We intentionally do NOT define `window.fileStorage` — `isElectron()` in
 * `indexed-db-storage.ts` must remain `false` so all stores fall back to the
 * in-memory localStorage mock instead of attempting Electron IPC calls.
 */

function createMemoryLocalStorage(): Storage {
  const store = new Map<string, string>();

  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
  };

  return storage;
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryLocalStorage(),
    writable: true,
    configurable: true,
  });
}

// sessionStorage is used by a few stores; provide the same in-memory mock.
if (typeof globalThis.sessionStorage === 'undefined') {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: createMemoryLocalStorage(),
    writable: true,
    configurable: true,
  });
}
