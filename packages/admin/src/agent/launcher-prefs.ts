export const AGENT_LAUNCHER_STORAGE_KEY = "denizlg24:agent-launcher";

export interface AgentLauncherPrefs {
  xPct: number;
  yPct: number;
  hidden: boolean;
}

export const DEFAULT_AGENT_LAUNCHER_PREFS: AgentLauncherPrefs = {
  xPct: 0.94,
  yPct: 0.9,
  hidden: false,
};

function fraction(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

export function loadAgentLauncherPrefs(): AgentLauncherPrefs {
  if (typeof window === "undefined") return DEFAULT_AGENT_LAUNCHER_PREFS;
  try {
    const parsed = JSON.parse(
      localStorage.getItem(AGENT_LAUNCHER_STORAGE_KEY) ?? "null",
    ) as Partial<AgentLauncherPrefs> | null;
    return {
      xPct: fraction(parsed?.xPct, DEFAULT_AGENT_LAUNCHER_PREFS.xPct),
      yPct: fraction(parsed?.yPct, DEFAULT_AGENT_LAUNCHER_PREFS.yPct),
      hidden:
        typeof parsed?.hidden === "boolean"
          ? parsed.hidden
          : DEFAULT_AGENT_LAUNCHER_PREFS.hidden,
    };
  } catch {
    return DEFAULT_AGENT_LAUNCHER_PREFS;
  }
}

export function saveAgentLauncherPrefs(prefs: AgentLauncherPrefs): void {
  localStorage.setItem(AGENT_LAUNCHER_STORAGE_KEY, JSON.stringify(prefs));
}

export function clampLauncherPosition(
  x: number,
  y: number,
  size = 36,
  margin = 8,
): { x: number; y: number } {
  return {
    x: Math.min(
      Math.max(margin, x),
      Math.max(margin, window.innerWidth - size - margin),
    ),
    y: Math.min(
      Math.max(margin, y),
      Math.max(margin, window.innerHeight - size - margin),
    ),
  };
}
