import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  Agent,
  FileChange,
  FileDiff,
  GitAction,
  GitChanges,
  LaunchOptions,
  ModelOption,
  Provider,
} from "./types";
export const native = isTauri();
export const api = {
  gitChanges: (id: string) => invoke<GitChanges>("git_changes", { id }),
  gitDiff: (id: string, file: FileChange) =>
    invoke<FileDiff>("git_file_diff", {
      id,
      path: file.path,
      oldPath: file.oldPath,
      untracked: file.status === "?",
    }),
  gitAction: (id: string, action: GitAction) =>
    invoke<string>("git_action", { id, action }),
  restart: () => invoke<void>("restart_app"),
  snapshot: () => invoke<Agent[]>("snapshot"),
  providers: () => invoke<Record<Provider, boolean>>("providers"),
  models: (provider: Provider) =>
    invoke<ModelOption[]>("available_models", { provider }),
  create: (provider: Provider, cwd: string, options: LaunchOptions) =>
    invoke<Agent>("create_agent", { provider, cwd, options }),
  directory: () =>
    open({
      directory: true,
      multiple: false,
      title: "Agent working directory",
    }),
  read: async (id: string, after: number) => {
    const raw = await invoke<ArrayBuffer | number[]>("read_terminal", {
      id,
      after,
    });
    const bytes =
      raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return {
      cursor: Number(view.getBigUint64(0, true)),
      truncated: bytes[8] === 1,
      data: bytes.subarray(9),
    };
  },
  resume: (id: string) => invoke<Agent>("resume_agent", { id }),
  rename: (id: string, name: string) =>
    invoke<void>("rename_agent", { id, name }),
  write: (id: string, data: string) =>
    invoke<void>("write_terminal", { id, data }),
  resize: (id: string, cols: number, rows: number) =>
    invoke<void>("resize_terminal", { id, cols, rows }),
  stop: (id: string) => invoke<void>("stop_agent", { id }),
};
