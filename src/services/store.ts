// Local persistence layer for the mock services.
// Uses localStorage on the client and a plain in-memory fallback on the server.
// Replace with real Supabase queries when integrating the Python worker.

const MEMORY: Record<string, string> = {};

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readKey<T>(key: string, fallback: T): T {
  try {
    const raw = isBrowser() ? window.localStorage.getItem(key) : MEMORY[key];
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeKey<T>(key: string, value: T) {
  const raw = JSON.stringify(value);
  if (isBrowser()) window.localStorage.setItem(key, raw);
  else MEMORY[key] = raw;
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
