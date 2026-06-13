import { isTauri } from "./platform";

/**
 * File save/open seam. In Tauri these use the native save/open dialog plus
 * `plugin-fs`; in a plain browser they fall back to an `<a download>` trigger
 * and a hidden `<input type="file">` so the same actions degrade gracefully.
 */

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface PickedFile {
  name: string;
  data: Uint8Array<ArrayBuffer>;
}

/**
 * Persist bytes to disk. Returns false if the user cancelled the save dialog
 * (Tauri only — the browser download cannot be cancelled programmatically).
 */
export async function saveFile(
  filename: string,
  data: Uint8Array<ArrayBuffer> | string,
  options?: {
    mimeType?: string;
    defaultPath?: string;
    filters?: DialogFilter[];
  },
): Promise<boolean> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;

  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath: options?.defaultPath ?? filename,
      filters: options?.filters,
    });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  }

  const blob = new Blob([bytes], {
    type: options?.mimeType ?? "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Prompt the user to pick a single file and return its bytes. Resolves null
 * when the picker is dismissed (Tauri) or no file is chosen.
 */
export async function pickFile(options?: {
  accept?: string;
  filters?: DialogFilter[];
}): Promise<PickedFile | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: options?.filters,
    });
    if (typeof selected !== "string") return null;
    const data = new Uint8Array(await readFile(selected));
    const name = selected.split(/[\\/]/).pop() ?? "file";
    return { name, data };
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (options?.accept) input.accept = options.accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({
        name: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
      });
    };
    input.click();
  });
}

/**
 * Pick a directory. Tauri-only — the browser has no equivalent, so callers
 * should gate the affordance on `isTauri()` and treat null as "not supported".
 */
export async function pickDirectory(
  defaultPath?: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, defaultPath });
  return typeof selected === "string" ? selected : null;
}
