"use client";

import {
  ENTITY_KINDS,
  type EntityKind,
  parseEntityRef,
  RECORD_REFS_MAX,
  type RecordSummary,
  recordSearchResponseSchema,
  recordsResponseSchema,
} from "@repo/schemas";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  ChartLine,
  ClipboardList,
  Eye,
  FileCode2,
  FileText,
  FolderGit2,
  Folders,
  GraduationCap,
  KanbanSquare,
  Landmark,
  Mail,
  MessageSquare,
  Mic,
  Milestone,
  Newspaper,
  NotebookPen,
  PenTool,
  PiggyBank,
  Receipt,
  Repeat,
  Server,
  Sheet,
  SquareKanban,
  UserRound,
  Users,
} from "lucide-react";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";
import type { AdminClient } from "../client";
import { useAdmin } from "../provider";
import { CourseFull, EnvelopeFull, NoteFull, PageFull } from "./record-full";
import type { WorkspaceNav } from "./refs";

/*
 * The record registry: for every entity kind, how it is labelled, where it
 * opens in this host, and the module's own component for full mode where the
 * module has one that stands alone. Summaries come from one batched fetch
 * through the admin client (`GET workspace/records?refs=`), whose server
 * side is `apps/web/lib/workspace/records.ts`; adding a kind is an entry
 * there and one here.
 */

export interface RecordFullProps {
  id: string;
  editable: boolean;
}

export interface RecordKindDef {
  label: string;
  icon: LucideIcon;
  href: (nav: WorkspaceNav, id: string) => string | undefined;
  /** The module's own view; kinds without one show the card with every field. */
  Full?: ComponentType<RecordFullProps>;
}

export const RECORD_KINDS: Record<EntityKind, RecordKindDef> = {
  page: {
    label: "Page",
    icon: FileText,
    href: (nav, id) => nav.pageHref(id),
    Full: PageFull,
  },
  note: {
    label: "Note",
    icon: NotebookPen,
    href: (nav) => nav.moduleHref("notes"),
    Full: NoteFull,
  },
  "kanban-board": {
    label: "Board",
    icon: SquareKanban,
    href: (nav) => nav.moduleHref("kanban"),
  },
  "kanban-card": {
    label: "Card",
    icon: KanbanSquare,
    href: (nav) => nav.moduleHref("kanban"),
  },
  whiteboard: {
    label: "Whiteboard",
    icon: PenTool,
    href: (nav) => nav.moduleHref("whiteboard"),
  },
  person: {
    label: "Person",
    icon: UserRound,
    href: (nav) => nav.moduleHref("people"),
  },
  course: {
    label: "Course",
    icon: GraduationCap,
    href: (nav, id) => nav.routes.courses.detail(id),
    Full: CourseFull,
  },
  envelope: {
    label: "Envelope",
    icon: PiggyBank,
    href: (nav, id) => nav.routes.finance.envelope(id),
    Full: EnvelopeFull,
  },
  paper: {
    label: "Paper",
    icon: FileText,
    href: (nav, id) => nav.routes.papers.read(id),
  },
  "voice-note": {
    label: "Voice note",
    icon: Mic,
    href: (nav) => nav.moduleHref("voice-notes"),
  },
  "latex-project": {
    label: "LaTeX",
    icon: FileCode2,
    href: (nav, id) => nav.routes.latexProject(id),
  },
  "calendar-event": {
    label: "Event",
    icon: CalendarClock,
    href: (nav) => nav.moduleHref("calendar"),
  },
  "blog-post": {
    label: "Blog post",
    icon: Newspaper,
    href: (nav, id) => nav.routes.blog.edit(id),
  },
  project: {
    label: "Project",
    icon: FolderGit2,
    href: (nav, id) => nav.routes.projects.edit(id),
  },
  "timeline-item": {
    label: "Timeline",
    icon: Milestone,
    href: (nav, id) => nav.routes.timeline.edit(id),
  },
  contact: {
    label: "Contact",
    icon: MessageSquare,
    href: (nav, id) => nav.routes.contacts.detail(id),
  },
  email: {
    label: "Email",
    icon: Mail,
    href: (nav) => nav.moduleHref("inbox"),
  },
  "finance-account": {
    label: "Account",
    icon: Landmark,
    href: (nav, id) => nav.routes.finance.account(id),
  },
  "finance-entry": {
    label: "Transaction",
    icon: Receipt,
    href: (nav, id) => nav.routes.finance.entry(id),
  },
  "finance-rule": {
    label: "Recurring",
    icon: Repeat,
    href: (nav, id) => nav.routes.finance.rule(id),
  },
  "journal-entry": {
    label: "Journal",
    icon: BookOpen,
    href: (nav) => nav.moduleHref("journal"),
  },
  spreadsheet: {
    label: "Spreadsheet",
    icon: Sheet,
    href: (nav) => nav.moduleHref("spreadsheets"),
  },
  resource: {
    label: "Resource",
    icon: Server,
    href: (nav) => nav.moduleHref("resources"),
  },
  "person-group": {
    label: "People group",
    icon: Users,
    href: (nav) => nav.moduleHref("people"),
  },
  "note-group": {
    label: "Note group",
    icon: Folders,
    href: (nav) => nav.moduleHref("notes"),
  },
  "agent-task": {
    label: "Agent task",
    icon: Bot,
    href: (nav) => nav.moduleHref("agent-tasks"),
  },
  "course-assignment": {
    label: "Coursework",
    icon: ClipboardList,
    href: (nav) => nav.moduleHref("courses"),
  },
  "work-job": {
    label: "Job",
    icon: BriefcaseBusiness,
    href: (nav) => nav.routes.hours,
  },
  "timetable-entry": {
    label: "Class slot",
    icon: CalendarDays,
    href: (nav) => nav.moduleHref("timetable"),
  },
  portfolio: {
    label: "Portfolio",
    icon: ChartLine,
    href: (nav, id) => nav.routes.market.portfolio(id),
  },
  watchlist: {
    label: "Watchlist",
    icon: Eye,
    href: (nav) => nav.routes.markets,
  },
};

export function recordHref(nav: WorkspaceNav, ref: string): string | undefined {
  const parsed = parseEntityRef(ref);
  return parsed ? RECORD_KINDS[parsed.kind].href(nav, parsed.id) : undefined;
}

// --- the batched summary cache ------------------------------------------------

const FRESH_MS = 60_000;

type Entry = { record: RecordSummary | null; at: number };

const cache = new Map<string, Entry>();
const queued = new Set<string>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

async function flush(client: AdminClient) {
  flushTimer = null;
  const refs = [...queued];
  queued.clear();
  for (const ref of refs) inflight.add(ref);
  for (let i = 0; i < refs.length; i += RECORD_REFS_MAX) {
    const chunk = refs.slice(i, i + RECORD_REFS_MAX);
    try {
      const { records, missing } = recordsResponseSchema.parse(
        await client.get(
          `workspace/records?refs=${encodeURIComponent(chunk.join(","))}`,
        ),
      );
      const at = Date.now();
      for (const record of records) cache.set(record.ref, { record, at });
      for (const ref of missing) cache.set(ref, { record: null, at });
      // Left uncached: the next mount asks again.
    } finally {
      for (const ref of chunk) inflight.delete(ref);
    }
  }
  notify();
}

function request(client: AdminClient, ref: string, force = false) {
  const entry = cache.get(ref);
  if (!force && entry && Date.now() - entry.at < FRESH_MS) return;
  if (inflight.has(ref)) return;
  queued.add(ref);
  flushTimer ??= setTimeout(() => void flush(client), 0);
}

/** Seeds the cache with summaries already in hand (search results). */
export function primeRecords(records: readonly RecordSummary[]) {
  const at = Date.now();
  for (const record of records) cache.set(record.ref, { record, at });
  notify();
}

export type RecordState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; record: RecordSummary };

export function useRecord(ref: string | null): RecordState {
  const { client } = useAdmin();
  // The entry is the store snapshot, read through the hook: React Compiler
  // memoizes a plain `cache.get(ref)` on `ref` alone, so a card that rendered
  // before its summary arrived kept showing the skeleton forever.
  const read = useCallback(() => (ref ? cache.get(ref) : undefined), [ref]);
  const entry = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    if (ref) request(client, ref);
  }, [client, ref]);
  if (!ref || !parseEntityRef(ref)) return { status: "missing" };
  if (!entry) return { status: "loading" };
  return entry.record
    ? { status: "ready", record: entry.record }
    : { status: "missing" };
}

/** Drops cached summaries (after the module edited a record in full mode). */
export function useRefreshRecord(): (ref: string) => void {
  const { client } = useAdmin();
  return useCallback((ref: string) => request(client, ref, true), [client]);
}

// --- search -------------------------------------------------------------------

export async function searchRecords(
  client: AdminClient,
  query: string,
  kinds: readonly EntityKind[] = ENTITY_KINDS,
): Promise<RecordSummary[]> {
  const params = new URLSearchParams({ q: query });
  if (kinds.length < ENTITY_KINDS.length) {
    for (const kind of kinds) params.append("kind", kind);
  }
  const { records } = recordSearchResponseSchema.parse(
    await client.get(`workspace/records/search?${params.toString()}`),
  );
  primeRecords(records);
  return records;
}
