import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  Agent,
  FileChange,
  FileDiff,
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
  read: (id: string, after: number) =>
    invoke<{ chunks: number[][]; cursor: number; truncated: boolean }>(
      "read_terminal",
      { id, after },
    ),
  write: (id: string, data: string) =>
    invoke<void>("write_terminal", { id, data }),
  resize: (id: string, cols: number, rows: number) =>
    invoke<void>("resize_terminal", { id, cols, rows }),
  stop: (id: string) => invoke<void>("stop_agent", { id }),
};
