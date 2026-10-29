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

export const DASHBOARD_PREFIX = "/dashboard";

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

export type ModuleDef = {
  id: string;
  label: string;
  /** Absolute app path. */
  href: string;
  icon: LucideIcon;
  section: ModuleSectionId;
  /** Extra words the command palette matches on. */
  keywords?: string[];
  /** A secondary entry point (e.g. "new post") — listed in search, not the sidebar. */
  shortcut?: boolean;
};

const p = (path: string) => `${DASHBOARD_PREFIX}${path}`;

export const MODULES: ModuleDef[] = [
  {
    id: "inbox",
    label: "Inbox",
    href: p("/inbox"),
    icon: Inbox,
    section: "communication",
    keywords: ["email", "mail"],
  },
  {
    id: "triage",
    label: "Triage",
    href: p("/triage"),
    icon: Brain,
    section: "communication",
    keywords: ["email", "suggestions"],
  },
  {
    id: "contacts",
    label: "Contacts",
    href: p("/contacts"),
    icon: UserSquare,
    section: "communication",
    keywords: ["tickets", "messages"],
  },
  {
    id: "people",
    label: "People",
    href: p("/people"),
    icon: UsersRound,
    section: "communication",
    keywords: ["crm", "friends"],
  },

  {
    id: "calendar",
    label: "Calendar",
    href: p("/calendar"),
    icon: Calendar,
    section: "schedule",
    keywords: ["events"],
  },
  {
    id: "timetable",
    label: "Timetable",
    href: p("/timetable"),
    icon: CalendarDays,
    section: "schedule",
    keywords: ["classes"],
  },
  {
    id: "courses",
    label: "Courses",
    href: p("/courses"),
    icon: GraduationCap,
    section: "schedule",
    keywords: ["semester", "grades", "university"],
  },
  {
    id: "kanban",
    label: "Kanban",
    href: p("/kanban"),
    icon: Kanban,
    section: "schedule",
    keywords: ["tasks", "boards", "todo"],
  },
  {
    id: "hours",
    label: "Hours",
    href: p("/hours"),
    icon: Timer,
    section: "schedule",
    keywords: ["shifts", "work", "clock"],
  },
  {
    id: "pomodoro",
    label: "Pomodoro",
    href: p("/pomodoro"),
    icon: AlarmClock,
    section: "schedule",
    keywords: ["focus", "timer"],
  },

  {
    id: "notes",
    label: "Notes",
    href: p("/notes"),
    icon: FileText,
    section: "knowledge",
  },
  {
    id: "journal",
    label: "Journal",
    href: p("/journal"),
    icon: NotebookTabs,
    section: "knowledge",
    keywords: ["diary"],
  },
  {
    id: "voice-notes",
    label: "Voice notes",
    href: p("/voice-notes"),
    icon: Mic,
    section: "knowledge",
    keywords: ["recordings", "transcripts"],
  },
  {
    id: "papers",
    label: "Reading",
    href: p("/papers"),
    icon: BookOpen,
    section: "knowledge",
    keywords: ["papers", "books"],
  },
  {
    id: "whiteboard",
    label: "Whiteboards",
    href: p("/whiteboard"),
    icon: PenTool,
    section: "knowledge",
    keywords: ["draw", "canvas"],
  },
  {
    id: "whiteboard-today",
    label: "Today's board",
    href: p("/whiteboard/today"),
    icon: PenTool,
    section: "knowledge",
    keywords: ["whiteboard", "daily"],
    shortcut: true,
  },
  {
    id: "spreadsheets",
    label: "Spreadsheets",
    href: p("/spreadsheets"),
    icon: Table,
    section: "knowledge",
    keywords: ["sheets", "tables"],
  },
  {
    id: "latex",
    label: "LaTeX",
    href: p("/latex"),
    icon: FileCode2,
    section: "knowledge",
    keywords: ["tex", "documents"],
  },
  {
    id: "explored",
    label: "Explored",
    href: p("/explored"),
    icon: Earth,
    section: "knowledge",
    keywords: ["map", "location", "travel"],
  },

  {
    id: "finance",
    label: "Finance",
    href: p("/finance"),
    icon: CircleDollarSign,
    section: "money",
    keywords: ["ledger", "money"],
  },
  {
    id: "budget",
    label: "Budget",
    href: p("/finance/budget"),
    icon: PiggyBank,
    section: "money",
    keywords: ["envelopes", "finance"],
  },
  {
    id: "markets",
    label: "Markets",
    href: p("/markets"),
    icon: ChartCandlestick,
    section: "money",
    keywords: ["stocks", "quotes"],
  },
  {
    id: "portfolios",
    label: "Portfolios",
    href: p("/markets/portfolios"),
    icon: Wallet,
    section: "money",
    keywords: ["markets", "paper trading"],
  },
  {
    id: "holdings",
    label: "Holdings",
    href: p("/holdings"),
    icon: Landmark,
    section: "money",
    keywords: ["ibkr", "brokerage", "net worth"],
  },

  {
    id: "blog",
    label: "Blog",
    href: p("/blog"),
    icon: NotebookPen,
    section: "portfolio",
    keywords: ["posts"],
  },
  {
    id: "blog-new",
    label: "New post",
    href: p("/blog/new"),
    icon: NotebookPen,
    section: "portfolio",
    keywords: ["blog", "write"],
    shortcut: true,
  },
  {
    id: "comments",
    label: "Comments",
    href: p("/blog/comments"),
    icon: MessageCircle,
    section: "portfolio",
    keywords: ["blog", "moderation"],
  },
  {
    id: "projects",
    label: "Projects",
    href: p("/projects"),
    icon: FolderGit2,
    section: "portfolio",
  },
  {
    id: "projects-new",
    label: "New project",
    href: p("/projects/new"),
    icon: FolderGit2,
    section: "portfolio",
    keywords: ["projects"],
    shortcut: true,
  },
  {
    id: "timeline",
    label: "Timeline",
    href: p("/timeline"),
    icon: Briefcase,
    section: "portfolio",
    keywords: ["experience", "career"],
  },
  {
    id: "now",
    label: "Now page",
    href: p("/now"),
    icon: Clock,
    section: "portfolio",
  },
  {
    id: "cv",
    label: "CV",
    href: p("/cv"),
    icon: FileUser,
    section: "portfolio",
    keywords: ["resume"],
  },

  {
    id: "resources",
    label: "Resources",
    href: p("/resources"),
    icon: Radio,
    section: "system",
    keywords: ["uptime", "servers", "health"],
  },
  {
    id: "authenticator",
    label: "Authenticator",
    href: p("/authenticator"),
    icon: KeyRound,
    section: "system",
    keywords: ["totp", "2fa", "codes"],
  },
  {
    id: "agent-memory",
    label: "Agent memory",
    href: p("/agent-memory"),
    icon: BrainCircuit,
    section: "system",
    keywords: ["memories"],
  },
  {
    id: "agent-tasks",
    label: "Agent tasks",
    href: p("/agent-tasks"),
    icon: Brain,
    section: "system",
    keywords: ["cron", "scheduled"],
  },
  {
    id: "llm-usage",
    label: "Token usage",
    href: p("/llm-usage"),
    icon: DollarSign,
    section: "system",
    keywords: ["llm", "cost", "spend"],
  },
  {
    id: "settings",
    label: "Settings",
    href: p("/settings"),
    icon: Settings,
    section: "system",
    keywords: ["preferences"],
  },
];

const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));

export function getModule(id: string): ModuleDef | undefined {
  return MODULE_BY_ID.get(id);
}

/** Sidebar entries: every module that is a destination rather than a shortcut. */
export const SIDEBAR_MODULES = MODULES.filter((m) => !m.shortcut);

/** The module a path belongs to — the longest href that prefixes it. */
export function moduleForPath(pathname: string): ModuleDef | undefined {
  let best: ModuleDef | undefined;
  for (const m of MODULES) {
    if (pathname === m.href || pathname.startsWith(`${m.href}/`)) {
      if (!best || m.href.length > best.href.length) best = m;
    }
  }
  return best;
}
