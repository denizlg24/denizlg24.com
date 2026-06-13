import { isTauri } from "./platform";

/**
 * Minimal key/value persistence shared by settings and the pomodoro store.
 * Tauri uses `plugin-store` (a JSON file on disk); the browser falls back to
 * `localStorage` so values like the API key still persist between reloads.
 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

function localStorageStore(
  filename: string,
  defaults: Record<string, unknown>,
): KeyValueStore {
  const storageKey = `denizlg24:${filename}`;

  const read = (): Record<string, unknown> => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw
        ? { ...defaults, ...(JSON.parse(raw) as Record<string, unknown>) }
        : { ...defaults };
    } catch {
      return { ...defaults };
    }
  };

  const write = (data: Record<string, unknown>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch {}
  };

  return {
    async get<T>(key: string): Promise<T | undefined> {
      return read()[key] as T | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      const data = read();
      data[key] = value;
      write(data);
    },
  };
}

export async function loadKeyValueStore(
  filename: string,
  defaults: Record<string, unknown>,
): Promise<KeyValueStore> {
  if (isTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    return load(filename, { defaults, autoSave: true });
  }
  return localStorageStore(filename, defaults);
}
