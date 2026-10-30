import type { BlockType } from "@repo/schemas";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bookmark,
  Bot,
  CalendarClock,
  ChevronRight,
  ChevronsRight,
  Clock,
  Code,
  Coins,
  Columns2,
  FileStack,
  FileText,
  GraduationCap,
  Heading2,
  Image,
  KanbanSquare,
  LayoutGrid,
  Lightbulb,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  Paperclip,
  PenTool,
  PiggyBank,
  Pilcrow,
  Quote,
  Repeat2,
  Sigma,
  Sun,
  Table,
  UserSquare,
} from "lucide-react";
import type { WorkspaceNav } from "./refs";

export type BlockCategory =
  | "Text"
  | "Media"
  | "Layout"
  | "Today"
  | "Work"
  | "Money"
  | "System";

export type BlockMeta = {
  label: string;
  icon: LucideIcon;
  category: BlockCategory;
  /** Where a widget's header links: the surface it summarises, when the host has one. */
  href?: (nav: WorkspaceNav) => string | undefined;
  keywords?: string[];
  /** Widgets with no section header by default. */
  headerless?: boolean;
  /** Never offered on its own: a column only exists inside columns. */
  hidden?: boolean;
};

export const BLOCK_CATALOG: Record<BlockType, BlockMeta> = {
  paragraph: {
    label: "Text",
    icon: Pilcrow,
    category: "Text",
    keywords: ["paragraph", "plain"],
  },
  heading: {
    label: "Heading",
    icon: Heading2,
    category: "Text",
    keywords: ["title", "h1", "h2", "h3"],
  },
  bullet: {
    label: "Bulleted list",
    icon: List,
    category: "Text",
    keywords: ["ul", "unordered", "-"],
  },
  numbered: {
    label: "Numbered list",
    icon: ListOrdered,
    category: "Text",
    keywords: ["ol", "ordered", "1."],
  },
  todo: {
    label: "To-do",
    icon: ListChecks,
    category: "Text",
    keywords: ["checkbox", "task", "[]"],
  },
  toggle: {
    label: "Toggle",
    icon: ChevronRight,
    category: "Text",
    keywords: ["collapse", "details", "fold"],
  },
  callout: {
    label: "Callout",
    icon: Lightbulb,
    category: "Text",
    keywords: ["note", "info", "warning"],
  },
  quote: {
    label: "Quote",
    icon: Quote,
    category: "Text",
    keywords: ["blockquote", ">"],
  },
  code: {
    label: "Code",
    icon: Code,
    category: "Text",
    keywords: ["snippet", "```"],
  },
  equation: {
    label: "Equation",
    icon: Sigma,
    category: "Text",
    keywords: ["math", "latex", "katex", "formula"],
  },
  divider: {
    label: "Divider",
    icon: Minus,
    category: "Layout",
    keywords: ["separator", "line", "hr", "---"],
  },
  columns: {
    label: "Columns",
    icon: Columns2,
    category: "Layout",
    keywords: ["layout", "side by side", "grid"],
  },
  column: {
    label: "Column",
    icon: Columns2,
    category: "Layout",
    hidden: true,
  },
  table: {
    label: "Table",
    icon: Table,
    category: "Layout",
    keywords: ["grid", "rows", "cells"],
  },
  toc: {
    label: "Table of contents",
    icon: ListTree,
    category: "Layout",
    keywords: ["toc", "outline", "headings"],
  },
  breadcrumb: {
    label: "Breadcrumb",
    icon: ChevronsRight,
    category: "Layout",
    keywords: ["path", "parents"],
  },
  synced: {
    label: "Synced block",
    icon: Repeat2,
    category: "Layout",
    keywords: ["mirror", "reference", "embed", "transclude"],
  },
  links: {
    label: "Links",
    icon: Link2,
    category: "Layout",
    keywords: ["shortcuts", "pages", "modules"],
  },
  subpages: {
    label: "Sub-pages",
    icon: FileStack,
    category: "Layout",
    keywords: ["children", "pages"],
  },
  modules: {
    label: "All modules",
    icon: LayoutGrid,
    category: "Layout",
    keywords: ["index", "apps", "everything"],
  },
  image: {
    label: "Image",
    icon: Image,
    category: "Media",
    keywords: ["picture", "photo", "upload"],
  },
  file: {
    label: "File",
    icon: Paperclip,
    category: "Media",
    keywords: ["attachment", "pdf", "upload"],
  },
  bookmark: {
    label: "Bookmark",
    icon: Bookmark,
    category: "Media",
    keywords: ["link", "url", "embed", "preview"],
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
  "Text",
  "Media",
  "Layout",
  "Today",
  "Work",
  "Money",
  "System",
];
