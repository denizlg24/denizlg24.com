import {
  Activity,
  Bell,
  Brain,
  ChartCandlestick,
  ChartSpline,
  FileText,
  LayoutGrid,
  type LucideIcon,
  MessageSquareText,
  MonitorDot,
  Newspaper,
  Settings2,
  Star,
  Wallet,
} from "lucide-react";
import type { Workspace } from "@/lib/models";

export const views = [
  { view: "desk", label: "Desk", icon: LayoutGrid },
  { view: "security", label: "Security", icon: ChartCandlestick },
  { view: "monitor", label: "Monitor", icon: MonitorDot },
  { view: "overlay", label: "Charts", icon: ChartSpline },
  { view: "markets", label: "Markets", icon: Activity },
  { view: "portfolio", label: "Portfolio", icon: Wallet },
  { view: "research", label: "Research", icon: Newspaper },
  { view: "watchlists", label: "Watchlists", icon: Star },
  { view: "reports", label: "Reports", icon: FileText },
  { view: "alerts", label: "Alerts", icon: Bell },
  { view: "memory", label: "Memory", icon: Brain },
  { view: "settings", label: "Settings", icon: Settings2 },
] as const satisfies readonly {
  view: string;
  label: string;
  icon: LucideIcon;
}[];

export type View = (typeof views)[number]["view"];

export const workspaceViews = views.filter((item) => item.view !== "settings");
export const preferenceViews = views.filter((item) => item.view === "settings");

export const assistantNav = {
  label: "Assistant",
  icon: MessageSquareText,
} as const satisfies { label: string; icon: LucideIcon };

export const viewLabel = (view: View) =>
  views.find((item) => item.view === view)?.label ?? "Desk";

const isView = (value: string): value is View =>
  views.some((item) => item.view === value);

export function viewFromHash(hash: string): View | undefined {
  const name = hash.split("?")[0];
  if (name === "overview") return "desk";
  return isView(name) ? name : undefined;
}

export const homeView = (home: Workspace["settings"]["home"]): View =>
  home === "overview" ? "desk" : home;

export const homeOptions: {
  value: Workspace["settings"]["home"];
  label: string;
}[] = [
  { value: "overview", label: "Desk" },
  { value: "markets", label: "Markets" },
  { value: "portfolio", label: "Portfolio" },
  { value: "research", label: "Research" },
];
