import type { BlockType } from "@repo/schemas";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CalendarClock,
  CheckSquare,
  Clock,
  Coins,
  FileStack,
  FileText,
  GraduationCap,
  Heading1,
  KanbanSquare,
  LayoutGrid,
  Link2,
  Minus,
  PenTool,
  PiggyBank,
  Sun,
  Type,
  UserSquare,
} from "lucide-react";
import type { WorkspaceNav } from "./refs";

export type BlockCategory = "Basic" | "Today" | "Work" | "Money" | "System";

export type BlockMeta = {
  label: string;
  icon: LucideIcon;
  category: BlockCategory;
  /** Where the block's header links: the surface it summarises, when the host has one. */
  href?: (nav: WorkspaceNav) => string | undefined;
  keywords?: string[];
  /** Content blocks have no section header by default. */
  headerless?: boolean;
};

export const BLOCK_CATALOG: Record<BlockType, BlockMeta> = {
  heading: {
    label: "Heading",
    icon: Heading1,
    category: "Basic",
    headerless: true,
    keywords: ["title"],
  },
  text: {
    label: "Text",
    icon: Type,
    category: "Basic",
    headerless: true,
    keywords: ["markdown", "paragraph", "note"],
  },
  todo: {
    label: "To-do list",
    icon: CheckSquare,
    category: "Basic",
    keywords: ["checklist", "tasks"],
  },
  divider: {
    label: "Divider",
    icon: Minus,
    category: "Basic",
    headerless: true,
    keywords: ["separator", "line"],
  },
  links: {
    label: "Links",
    icon: Link2,
    category: "Basic",
    keywords: ["shortcuts", "bookmarks"],
  },
  subpages: {
    label: "Sub-pages",
    icon: FileStack,
    category: "Basic",
    keywords: ["children", "pages"],
  },
  modules: {
    label: "All modules",
    icon: LayoutGrid,
    category: "Basic",
    keywords: ["index", "apps", "everything"],
  },
  greeting: {
    label: "Greeting",
    icon: Sun,
    category: "Today",
    headerless: true,
    keywords: ["date", "clock"],
  },
  stats: {
    label: "Counts",
    icon: BarChart3,
    category: "Today",
    keywords: ["stats", "overview", "numbers"],
  },
  agenda: {
    label: "Agenda",
    icon: CalendarClock,
    category: "Today",
    href: (nav) => nav.moduleHref("calendar"),
    keywords: ["schedule", "calendar", "events", "classes"],
  },
  now: {
    label: "Now",
    icon: Clock,
    category: "Today",
    href: (nav) => nav.moduleHref("now"),
    keywords: ["shift", "hours", "status"],
  },
  board: {
    label: "Today's board",
    icon: PenTool,
    category: "Today",
    href: (nav) => nav.moduleHref("whiteboard-today"),
    keywords: ["whiteboard", "todos"],
  },
  agent: {
    label: "Agent",
    icon: Bot,
    category: "Today",
    keywords: ["chat", "assistant", "ai"],
  },
  tasks: {
    label: "Tasks",
    icon: KanbanSquare,
    category: "Work",
    href: (nav) => nav.moduleHref("kanban"),
    keywords: ["kanban", "due"],
  },
  semester: {
    label: "Semester",
    icon: GraduationCap,
    category: "Work",
    href: (nav) => nav.moduleHref("courses"),
    keywords: ["courses", "deadlines", "grades"],
  },
  notes: {
    label: "Recent notes",
    icon: FileText,
    category: "Work",
    href: (nav) => nav.moduleHref("notes"),
  },
  contacts: {
    label: "Contacts",
    icon: UserSquare,
    category: "Work",
    href: (nav) => nav.moduleHref("contacts"),
    keywords: ["messages", "tickets"],
  },
  budget: {
    label: "Budget",
    icon: PiggyBank,
    category: "Money",
    href: (nav) => nav.moduleHref("budget"),
    keywords: ["envelopes", "spend"],
  },
  alerts: {
    label: "Budget alerts",
    icon: AlertTriangle,
    category: "Money",
    href: (nav) => `${nav.routes.finance.root}/alerts`,
    keywords: ["finance", "warnings"],
  },
  resources: {
    label: "Resources",
    icon: Activity,
    category: "System",
    href: (nav) => nav.moduleHref("resources"),
    keywords: ["uptime", "health", "servers"],
  },
  llm: {
    label: "LLM spend",
    icon: Coins,
    category: "System",
    href: (nav) => nav.moduleHref("llm-usage"),
    keywords: ["tokens", "cost", "usage"],
  },
};

export const BLOCK_CATEGORIES: BlockCategory[] = [
  "Basic",
  "Today",
  "Work",
  "Money",
  "System",
];
