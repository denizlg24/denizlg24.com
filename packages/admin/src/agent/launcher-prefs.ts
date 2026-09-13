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

export const AGENT_DOCK_STORAGE_KEY = "denizlg24:agent-dock";

export const AGENT_DOCK_MIN_WIDTH = 360;
export const AGENT_DOCK_DEFAULT_WIDTH = 440;

export interface AgentDockPrefs {
  open: boolean;
  width: number;
}

export const DEFAULT_AGENT_DOCK_PREFS: AgentDockPrefs = {
  open: false,
  width: AGENT_DOCK_DEFAULT_WIDTH,
};

function readStored(key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return typeof parsed === "object" && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  } catch {
    return {};
  }
}

export function loadAgentDockPrefs(): AgentDockPrefs {
  if (typeof window === "undefined") return DEFAULT_AGENT_DOCK_PREFS;
  const stored = readStored(AGENT_DOCK_STORAGE_KEY);
  return {
    open: stored.open === true,
    width:
      typeof stored.width === "number" && Number.isFinite(stored.width)
        ? Math.max(AGENT_DOCK_MIN_WIDTH, Math.round(stored.width))
        : AGENT_DOCK_DEFAULT_WIDTH,
  };
}

export function saveAgentDockPrefs(prefs: AgentDockPrefs): void {
  localStorage.setItem(AGENT_DOCK_STORAGE_KEY, JSON.stringify(prefs));
}

export const AGENT_COMPOSER_STORAGE_KEY = "denizlg24:agent-composer";

/** Composer toggles a new conversation starts from: the last ones used. */
export interface AgentComposerPrefs {
  model: string | null;
  webSearch: boolean;
  webFetch: boolean;
  thinkLonger: boolean;
  executionMode: "interactive" | "yolo";
}

export const DEFAULT_AGENT_COMPOSER_PREFS: AgentComposerPrefs = {
  model: null,
  webSearch: false,
  webFetch: false,
  thinkLonger: false,
  executionMode: "interactive",
};

export function loadAgentComposerPrefs(): AgentComposerPrefs {
  if (typeof window === "undefined") return DEFAULT_AGENT_COMPOSER_PREFS;
  const stored = readStored(AGENT_COMPOSER_STORAGE_KEY);
  return {
    model: typeof stored.model === "string" ? stored.model : null,
    webSearch: stored.webSearch === true,
    webFetch: stored.webFetch === true,
    thinkLonger: stored.thinkLonger === true,
    executionMode: stored.executionMode === "yolo" ? "yolo" : "interactive",
  };
}

export function saveAgentComposerPrefs(prefs: AgentComposerPrefs): void {
  localStorage.setItem(AGENT_COMPOSER_STORAGE_KEY, JSON.stringify(prefs));
}
