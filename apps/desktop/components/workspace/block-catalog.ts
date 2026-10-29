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
import { DASHBOARD_PREFIX } from "@/lib/workspace/modules";
import type { BlockType } from "@/lib/workspace/schema";

export type BlockCategory = "Basic" | "Today" | "Work" | "Money" | "System";

export type BlockMeta = {
  label: string;
  icon: LucideIcon;
  category: BlockCategory;
  /** The module the block summarises; its header links there. */
  href?: string;
  keywords?: string[];
  /** Content blocks have no section header by default. */
  headerless?: boolean;
};

const p = (path: string) => `${DASHBOARD_PREFIX}${path}`;

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
    href: p("/calendar"),
    keywords: ["schedule", "calendar", "events", "classes"],
  },
  now: {
    label: "Now",
    icon: Clock,
    category: "Today",
    href: p("/now"),
    keywords: ["shift", "hours", "status"],
  },
  board: {
    label: "Today's board",
    icon: PenTool,
    category: "Today",
    href: p("/whiteboard/today"),
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
    href: p("/kanban"),
    keywords: ["kanban", "due"],
  },
  semester: {
    label: "Semester",
    icon: GraduationCap,
    category: "Work",
    href: p("/courses"),
    keywords: ["courses", "deadlines", "grades"],
  },
  notes: {
    label: "Recent notes",
    icon: FileText,
    category: "Work",
    href: p("/notes"),
  },
  contacts: {
    label: "Contacts",
    icon: UserSquare,
    category: "Work",
    href: p("/contacts"),
    keywords: ["messages", "tickets"],
  },
  budget: {
    label: "Budget",
    icon: PiggyBank,
    category: "Money",
    href: p("/finance/budget"),
    keywords: ["envelopes", "spend"],
  },
  alerts: {
    label: "Budget alerts",
    icon: AlertTriangle,
    category: "Money",
    href: p("/finance/alerts"),
    keywords: ["finance", "warnings"],
  },
  resources: {
    label: "Resources",
    icon: Activity,
    category: "System",
    href: p("/resources"),
    keywords: ["uptime", "health", "servers"],
  },
  llm: {
    label: "LLM spend",
    icon: Coins,
    category: "System",
    href: p("/llm-usage"),
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
