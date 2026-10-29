import type { LucideIcon } from "lucide-react";
import {
  AlarmClock,
  BookOpen,
  Brain,
  BrainCircuit,
  Briefcase,
  Calendar,
  CalendarDays,
  ChartCandlestick,
  CircleDollarSign,
  Clock,
  DollarSign,
  Earth,
  FileCode2,
  FileText,
  FileUser,
  FolderGit2,
  GraduationCap,
  Inbox,
  Kanban,
  KeyRound,
  Landmark,
  MessageCircle,
  Mic,
  NotebookPen,
  NotebookTabs,
  PenTool,
  PiggyBank,
  Radio,
  Settings,
  Table,
  Timer,
  UserSquare,
  UsersRound,
  Wallet,
} from "lucide-react";

export type ModuleSectionId =
  | "portfolio"
  | "communication"
  | "schedule"
  | "money"
  | "knowledge"
  | "system";

export type ModuleSection = { id: ModuleSectionId; label: string };

export const MODULE_SECTIONS: ModuleSection[] = [
  { id: "communication", label: "Communication" },
  { id: "schedule", label: "Schedule" },
  { id: "knowledge", label: "Knowledge" },
  { id: "money", label: "Money" },
  { id: "portfolio", label: "Portfolio" },
  { id: "system", label: "System" },
];

type ModuleSpec = {
  id: string;
  label: string;
  icon: LucideIcon;
  section: ModuleSectionId;
  /** Extra words the command palette matches on. */
  keywords?: readonly string[];
  /** A secondary entry point (e.g. "new post") — listed in search, not the sidebar. */
  shortcut?: boolean;
};

/**
 * Every module either host can open. Where each one lives is the host's
 * business (`routes.workspace.modules`); a module the host has no surface
 * for is dropped from the sidebar, search and blocks alike.
 */
const MODULE_SPECS = [
  {
    id: "inbox",
    label: "Inbox",
    icon: Inbox,
    section: "communication",
    keywords: ["email", "mail"],
  },
  {
    id: "triage",
    label: "Triage",
    icon: Brain,
    section: "communication",
    keywords: ["email", "suggestions"],
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: UserSquare,
    section: "communication",
    keywords: ["tickets", "messages"],
  },
  {
    id: "people",
    label: "People",
    icon: UsersRound,
    section: "communication",
    keywords: ["crm", "friends"],
  },

  {
    id: "calendar",
    label: "Calendar",
    icon: Calendar,
    section: "schedule",
    keywords: ["events"],
  },
  {
    id: "timetable",
    label: "Timetable",
    icon: CalendarDays,
    section: "schedule",
    keywords: ["classes"],
  },
  {
    id: "courses",
    label: "Courses",
    icon: GraduationCap,
    section: "schedule",
    keywords: ["semester", "grades", "university"],
  },
  {
    id: "kanban",
    label: "Kanban",
    icon: Kanban,
    section: "schedule",
    keywords: ["tasks", "boards", "todo"],
  },
  {
    id: "hours",
    label: "Hours",
    icon: Timer,
    section: "schedule",
    keywords: ["shifts", "work", "clock"],
  },
  {
    id: "pomodoro",
    label: "Pomodoro",
    icon: AlarmClock,
    section: "schedule",
    keywords: ["focus", "timer"],
  },

  {
    id: "notes",
    label: "Notes",
    icon: FileText,
    section: "knowledge",
  },
  {
    id: "journal",
    label: "Journal",
    icon: NotebookTabs,
    section: "knowledge",
    keywords: ["diary"],
  },
  {
    id: "voice-notes",
    label: "Voice notes",
    icon: Mic,
    section: "knowledge",
    keywords: ["recordings", "transcripts"],
  },
  {
    id: "papers",
    label: "Reading",
    icon: BookOpen,
    section: "knowledge",
    keywords: ["papers", "books"],
  },
  {
    id: "whiteboard",
    label: "Whiteboards",
    icon: PenTool,
    section: "knowledge",
    keywords: ["draw", "canvas"],
  },
  {
    id: "whiteboard-today",
    label: "Today's board",
    icon: PenTool,
    section: "knowledge",
    keywords: ["whiteboard", "daily"],
    shortcut: true,
  },
  {
    id: "spreadsheets",
    label: "Spreadsheets",
    icon: Table,
    section: "knowledge",
    keywords: ["sheets", "tables"],
  },
  {
    id: "latex",
    label: "LaTeX",
    icon: FileCode2,
    section: "knowledge",
    keywords: ["tex", "documents"],
  },
  {
    id: "explored",
    label: "Explored",
    icon: Earth,
    section: "knowledge",
    keywords: ["map", "location", "travel"],
  },

  {
    id: "finance",
    label: "Finance",
    icon: CircleDollarSign,
    section: "money",
    keywords: ["ledger", "money"],
  },
  {
    id: "budget",
    label: "Budget",
    icon: PiggyBank,
    section: "money",
    keywords: ["envelopes", "finance"],
  },
  {
    id: "markets",
    label: "Markets",
    icon: ChartCandlestick,
    section: "money",
    keywords: ["stocks", "quotes"],
  },
  {
    id: "portfolios",
    label: "Portfolios",
    icon: Wallet,
    section: "money",
    keywords: ["markets", "paper trading"],
  },
  {
    id: "holdings",
    label: "Holdings",
    icon: Landmark,
    section: "money",
    keywords: ["ibkr", "brokerage", "net worth"],
  },

  {
    id: "blog",
    label: "Blog",
    icon: NotebookPen,
    section: "portfolio",
    keywords: ["posts"],
  },
  {
    id: "blog-new",
    label: "New post",
    icon: NotebookPen,
    section: "portfolio",
    keywords: ["blog", "write"],
    shortcut: true,
  },
  {
    id: "comments",
    label: "Comments",
    icon: MessageCircle,
    section: "portfolio",
    keywords: ["blog", "moderation"],
  },
  {
    id: "projects",
    label: "Projects",
    icon: FolderGit2,
    section: "portfolio",
  },
  {
    id: "projects-new",
    label: "New project",
    icon: FolderGit2,
    section: "portfolio",
    keywords: ["projects"],
    shortcut: true,
  },
  {
    id: "timeline",
    label: "Timeline",
    icon: Briefcase,
    section: "portfolio",
    keywords: ["experience", "career"],
  },
  {
    id: "now",
    label: "Now page",
    icon: Clock,
    section: "portfolio",
  },
  {
    id: "cv",
    label: "CV",
    icon: FileUser,
    section: "portfolio",
    keywords: ["resume"],
  },

  {
    id: "resources",
    label: "Resources",
    icon: Radio,
    section: "system",
    keywords: ["uptime", "servers", "health"],
  },
  {
    id: "authenticator",
    label: "Authenticator",
    icon: KeyRound,
    section: "system",
    keywords: ["totp", "2fa", "codes"],
  },
  {
    id: "agent-memory",
    label: "Agent memory",
    icon: BrainCircuit,
    section: "system",
    keywords: ["memories"],
  },
  {
    id: "agent-tasks",
    label: "Agent tasks",
    icon: Brain,
    section: "system",
    keywords: ["cron", "scheduled"],
  },
  {
    id: "llm-usage",
    label: "Token usage",
    icon: DollarSign,
    section: "system",
    keywords: ["llm", "cost", "spend"],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    section: "system",
    keywords: ["preferences"],
  },
] as const satisfies readonly ModuleSpec[];

export type ModuleId = (typeof MODULE_SPECS)[number]["id"];

export type ModuleDef = ModuleSpec & {
  id: ModuleId;
  /** Absolute path in the current host. */
  href: string;
};

/** The modules this host has, in registry order. */
export function resolveModules(
  hrefs: Partial<Record<ModuleId, string>>,
): ModuleDef[] {
  const out: ModuleDef[] = [];
  for (const spec of MODULE_SPECS) {
    const href = hrefs[spec.id];
    if (href) out.push({ ...spec, href });
  }
  return out;
}

/** The module a path belongs to — the longest href that prefixes it. */
export function moduleForPath(
  modules: ModuleDef[],
  pathname: string,
): ModuleDef | undefined {
  let best: ModuleDef | undefined;
  for (const m of modules) {
    if (pathname === m.href || pathname.startsWith(`${m.href}/`)) {
      if (!best || m.href.length > best.href.length) best = m;
    }
  }
  return best;
}
