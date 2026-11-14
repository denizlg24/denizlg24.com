export type Provider = "codex" | "claude";
export interface Agent {
  settings?: LaunchOptions;
  id: string;
  rootId: string;
  parentId: string | null;
  sessionId: string | null;
  provider: Provider;
  name: string;
  cwd: string;
  status: string;
  activity: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  contextTokens: number | null;
  contextWindow: number | null;
  cost: number | null;
  rateLimits: Record<
    string,
    { used_percent?: number; resets_at?: number; window_minutes?: number }
  > | null;
  transcript: string;
  telemetryError: string | null;
}
export const count = (n: number | null) =>
  n === null
    ? "—"
    : new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);
export function tokens(a: Agent) {
  return a.inputTokens === null && a.outputTokens === null
    ? null
    : (a.inputTokens ?? 0) + (a.outputTokens ?? 0);
}
export const statusLabel: Record<string, string> = {
  starting: "Starting",
  working: "Working",
  waiting: "Needs approval",
  idle: "Ready",
  done: "Complete",
  stopped: "Stopped",
  error: "Exited with error",
};

export interface LaunchOptions {
  model: string;
  reasoning: string;
  permissions: "default" | "read-only" | "bypass";
}
export interface ModelOption {
  id: string;
  label: string;
  reasoning: string[];
}
