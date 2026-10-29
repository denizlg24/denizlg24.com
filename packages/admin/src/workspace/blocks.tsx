"use client";

import {
  type Block,
  type BlockOf,
  moduleRef,
  pageRef,
  type TodoItem,
} from "@repo/schemas";
import { Checkbox } from "@repo/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/command";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { Meter } from "@repo/ui/meter";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Skeleton } from "@repo/ui/skeleton";
import { Stat, StatGroup } from "@repo/ui/stat";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { AgentPanel } from "../agent/agent-panel";
import { formatMinor } from "./format";
import { MODULE_SECTIONS } from "./modules";
import { PageIcon, RefIcon } from "./page-icon";
import { pageTitle } from "./refs";
import { newId } from "./seed";
import { childPages, useWorkspaceStore } from "./store";
import {
  useBudgetAlerts,
  useDashboardStats,
  useDashboardToday,
  useSemesterOverview,
  useUpcomingTasks,
} from "./use-workspace-data";
import { useWorkspaceNav } from "./use-workspace-nav";

export type BlockProps<T extends Block["type"]> = {
  block: BlockOf<T>;
  pageId: string;
  editing: boolean;
  onChange: (block: BlockOf<T>) => void;
};

const MAX_ROWS = 6;

function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2.5 py-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </div>
  );
}

function Failed({ error }: { error: string }) {
  return <p className="py-2 text-xs text-destructive">{error}</p>;
}

function More({ count, href }: { count: number; href: string | undefined }) {
  if (count <= 0) return null;
  if (!href) {
    return (
      <span className="mt-1 self-start text-xs text-muted-foreground">
        +{count} more
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="mt-1 self-start text-xs text-muted-foreground hover:text-accent-strong"
    >
      +{count} more
    </Link>
  );
}

/** A link when the host has the surface, plain content when it does not. */
function MaybeLink({
  href,
  className,
  children,
}: {
  href: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  if (!href) return <>{children}</>;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function dueLabel(days: number, overdue: boolean) {
  if (overdue) return "overdue";
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}

/* ───────────── Basic ───────────── */

function HeadingBlock({ block, onChange }: BlockProps<"heading">) {
  return (
    <input
      defaultValue={block.text}
      placeholder="Heading"
      onBlur={(event) => {
        if (event.currentTarget.value !== block.text) {
          onChange({ ...block, text: event.currentTarget.value });
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="w-full bg-transparent text-xl font-semibold tracking-tight text-accent-strong outline-none placeholder:text-muted-foreground/50"
    />
  );
}

function TextBlock({ block, onChange }: BlockProps<"text">) {
  const [editing, setEditing] = useState(block.markdown === "");
  if (editing) {
    return (
      <textarea
        // biome-ignore lint/a11y/noAutofocus: entering edit mode is a click
        autoFocus={block.markdown !== ""}
        defaultValue={block.markdown}
        placeholder="Write…"
        onBlur={(event) => {
          const markdown = event.currentTarget.value;
          if (markdown !== block.markdown) onChange({ ...block, markdown });
          if (markdown.trim()) setEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur();
        }}
        className="field-sizing-content min-h-12 w-full resize-none bg-transparent text-sm leading-relaxed text-accent-strong outline-none placeholder:text-muted-foreground/50"
      />
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if (!(event.target instanceof Element && event.target.closest("a"))) {
          setEditing(true);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") setEditing(true);
      }}
      className="cursor-text text-sm"
    >
      <MarkdownRenderer content={block.markdown} allowRawHtml={false} />
    </div>
  );
}

function DividerBlock() {
  return <div className="h-px w-full bg-border" />;
}

function TodoBlock({ block, onChange }: BlockProps<"todo">) {
  const [draft, setDraft] = useState("");
  const setItems = (items: TodoItem[]) => onChange({ ...block, items });
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setItems([...block.items, { id: newId(), text, done: false }]);
    setDraft("");
  };
  const open = block.items.filter((i) => !i.done).length;

  return (
    <div className="flex flex-col">
      {block.items.map((item) => (
        <div
          key={item.id}
          className="group/todo flex min-h-8 items-center gap-2.5"
        >
          <Checkbox
            checked={item.done}
            onCheckedChange={(checked) =>
              setItems(
                block.items.map((i) =>
                  i.id === item.id ? { ...i, done: checked === true } : i,
                ),
              )
            }
          />
          <input
            defaultValue={item.text}
            onBlur={(event) => {
              const text = event.currentTarget.value;
              if (text !== item.text) {
                setItems(
                  block.items.map((i) =>
                    i.id === item.id ? { ...i, text } : i,
                  ),
                );
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (
                event.key === "Backspace" &&
                event.currentTarget.value === ""
              ) {
                setItems(block.items.filter((i) => i.id !== item.id));
              }
            }}
            className={cn(
              "min-w-0 flex-1 bg-transparent text-sm text-accent-strong outline-none",
              item.done && "text-muted-foreground line-through",
            )}
          />
          <button
            type="button"
            aria-label="Remove"
            onClick={() =>
              setItems(block.items.filter((i) => i.id !== item.id))
            }
            className="text-muted-foreground opacity-0 transition-opacity hover:text-accent-strong group-hover/todo:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex min-h-8 items-center gap-2.5">
        <Plus className="size-4 text-muted-foreground/60" />
        <input
          value={draft}
          placeholder="To-do"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
          onBlur={add}
          className="min-w-0 flex-1 bg-transparent text-sm text-accent-strong outline-none placeholder:text-muted-foreground/50"
        />
        {block.items.length > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {open}/{block.items.length}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RefPicker({
  exclude,
  onPick,
  children,
}: {
  exclude: Set<string>;
  onPick: (ref: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { sidebarModules } = useWorkspaceNav();
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  const livePages = Object.values(pages).filter(
    (p) => !p.deletedAt && !exclude.has(pageRef(p.id)),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Page or module" />
          <CommandList className="max-h-72">
            <CommandEmpty>No match</CommandEmpty>
            {livePages.length ? (
              <CommandGroup heading="Pages">
                {livePages.map((page) => (
                  <CommandItem
                    key={page.id}
                    value={`page ${pageTitle(page)}`}
                    onSelect={() => {
                      onPick(pageRef(page.id));
                      setOpen(false);
                    }}
                  >
                    <PageIcon icon={page.icon} />
                    {pageTitle(page)}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Modules">
              {sidebarModules
                .filter((m) => !exclude.has(moduleRef(m.id)))
                .map((module) => {
                  const Icon = module.icon;
                  return (
                    <CommandItem
                      key={module.id}
                      value={`module ${module.label} ${module.keywords?.join(" ") ?? ""}`}
                      onSelect={() => {
                        onPick(moduleRef(module.id));
                        setOpen(false);
                      }}
                    >
                      <Icon />
                      {module.label}
                    </CommandItem>
                  );
                })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Tile({
  href,
  icon,
  label,
  onRemove,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  onRemove?: () => void;
}) {
  return (
    <div className="group/tile relative">
      <Link
        href={href}
        className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-accent-strong transition-colors hover:bg-surface"
      >
        <span className="text-muted-foreground group-hover/tile:text-accent-strong">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </Link>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-accent-strong group-hover/tile:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

const TILE_GRID =
  "grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-2 gap-y-0.5 -mx-2.5";

function LinksBlock({ block, editing, onChange }: BlockProps<"links">) {
  const { resolveRef } = useWorkspaceNav();
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  const resolved = block.refs
    .map((ref) => resolveRef(ref, pages))
    .filter((r) => r !== null);
  return (
    <div className={TILE_GRID}>
      {resolved.map((r) => (
        <Tile
          key={r.ref}
          href={r.href}
          icon={<RefIcon resolved={r} />}
          label={r.label}
          onRemove={
            editing
              ? () =>
                  onChange({
                    ...block,
                    refs: block.refs.filter((x) => x !== r.ref),
                  })
              : undefined
          }
        />
      ))}
      {editing || resolved.length === 0 ? (
        <RefPicker
          exclude={new Set(block.refs)}
          onPick={(ref) => onChange({ ...block, refs: [...block.refs, ref] })}
        >
          <button
            type="button"
            className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-surface hover:text-accent-strong"
          >
            <Plus className="size-4" />
            Add
          </button>
        </RefPicker>
      ) : null}
    </div>
  );
}

function SubpagesBlock({ pageId }: BlockProps<"subpages">) {
  const router = useRouter();
  const { pageHref } = useWorkspaceNav();
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  const createPage = useWorkspaceStore((s) => s.createPage);
  const children = childPages(pages, pageId);
  return (
    <List>
      {children.map((child) => (
        <Link key={child.id} href={pageHref(child.id)}>
          <ListRow
            leading={<PageIcon icon={child.icon} />}
            title={pageTitle(child)}
            meta={`${child.blocks.length} blocks`}
          />
        </Link>
      ))}
      <ListRow
        leading={<Plus />}
        title={<span className="text-muted-foreground">New page</span>}
        onClick={() => router.push(pageHref(createPage(pageId)))}
      />
    </List>
  );
}

function ModulesBlock({ block }: BlockProps<"modules">) {
  const { sidebarModules } = useWorkspaceNav();
  const sections = block.sections.length
    ? MODULE_SECTIONS.filter((s) => block.sections.includes(s.id))
    : MODULE_SECTIONS;
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
      {sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
            {section.label}
          </span>
          <div className="-mx-2.5 flex flex-col">
            {sidebarModules
              .filter((m) => m.section === section.id)
              .map((module) => {
                const Icon = module.icon;
                return (
                  <Tile
                    key={module.id}
                    href={module.href}
                    icon={<Icon className="size-4" />}
                    label={module.label}
                  />
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────── Today ───────────── */

function greetingFor(hour: number) {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function GreetingBlock() {
  const today = useDashboardToday();
  const now = new Date();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">
        {format(now, "EEEE, d MMMM")}
      </span>
      <span className="font-calistoga text-3xl leading-tight text-accent-strong">
        {greetingFor(now.getHours())}
      </span>
      {today.data?.now ? (
        <span className="mt-1 line-clamp-2 text-sm text-foreground">
          {today.data.now}
        </span>
      ) : null}
    </div>
  );
}

function StatsBlock() {
  const { moduleHref, routes } = useWorkspaceNav();
  const stats = useDashboardStats();
  const today = useDashboardToday();
  if (stats.error) return <Failed error={stats.error} />;
  if (!stats.data) return <RowsSkeleton rows={2} />;
  const s = stats.data;
  const counts = today.data?.counts;
  const item = (
    label: string,
    value: number,
    href: string | undefined,
    alert = false,
  ) => (
    <MaybeLink
      href={href}
      className="rounded-md transition-opacity hover:opacity-75"
    >
      <Stat
        label={label}
        value={value}
        tone={alert && value > 0 ? "critical" : "default"}
      />
    </MaybeLink>
  );
  return (
    <StatGroup>
      {item("Unread mail", s.emails.unread, moduleHref("inbox"))}
      {item(
        "Action needed",
        counts?.actionNeeded ?? s.triage.actionRequired,
        moduleHref("triage"),
        true,
      )}
      {item(
        "Today",
        s.calendar.todayEvents + s.timetable.length,
        moduleHref("calendar"),
      )}
      {item("New contacts", s.contacts.unread, moduleHref("contacts"))}
      {item("Comments", s.comments.pending, moduleHref("comments"))}
      {item(
        "Budget alerts",
        counts?.budgetAlerts ?? 0,
        `${routes.finance.root}/alerts`,
        true,
      )}
      {item("Notes", s.notes.total, moduleHref("notes"))}
      {item("Projects", s.projects.total, moduleHref("projects"))}
    </StatGroup>
  );
}

function AgendaBlock() {
  const { moduleHref } = useWorkspaceNav();
  const today = useDashboardToday();
  if (today.error) return <Failed error={today.error} />;
  if (!today.data) return <RowsSkeleton />;
  const items = [...today.data.agenda].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  if (items.length === 0)
    return <EmptyState compact label="Nothing scheduled" />;
  const now = Date.now();
  return (
    <List>
      {items.slice(0, MAX_ROWS).map((item) => {
        const past = item.end ? Date.parse(item.end) < now : false;
        return (
          <ListRow
            key={item.id}
            className={cn(past && "opacity-50")}
            leading={
              <span
                className={cn(
                  "h-4 w-0.5 rounded-full",
                  item.kind === "class" ? "bg-accent" : "bg-accent-strong",
                )}
              />
            }
            title={item.title}
            description={item.place}
            meta={
              item.allDay ? "all day" : format(new Date(item.start), "HH:mm")
            }
          />
        );
      })}
      <More count={items.length - MAX_ROWS} href={moduleHref("calendar")} />
    </List>
  );
}

function NowBlock() {
  const { routes } = useWorkspaceNav();
  const today = useDashboardToday();
  if (today.error) return <Failed error={today.error} />;
  if (!today.data) return <RowsSkeleton rows={2} />;
  const { now, shift } = today.data;
  if (!now && !shift) return <EmptyState compact label="—" />;
  return (
    <div className="flex flex-col gap-3">
      {now ? (
        <p className="text-sm leading-relaxed text-accent-strong">{now}</p>
      ) : null}
      {shift ? (
        <Link
          href={routes.hours}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-accent-strong"
        >
          <StatusDot tone={shift.onBreak ? "warning" : "good"} />
          {shift.jobName} · {shift.onBreak ? "on break" : "clocked in"}{" "}
          {formatDistanceToNowStrict(new Date(shift.start))}
        </Link>
      ) : null}
    </div>
  );
}

function BoardBlock() {
  const { moduleHref } = useWorkspaceNav();
  const today = useDashboardToday();
  if (today.error) return <Failed error={today.error} />;
  if (!today.data) return <RowsSkeleton rows={3} />;
  const todos = today.data.board.todos;
  if (todos.length === 0) return <EmptyState compact label="No to-dos" />;
  return (
    <List>
      {todos.slice(0, MAX_ROWS).map((todo) => (
        <ListRow
          key={`${todo.elementId}-${todo.itemId}`}
          leading={<Checkbox checked={todo.completed} disabled />}
          title={
            <span
              className={cn(
                todo.completed && "text-muted-foreground line-through",
              )}
            >
              {todo.text}
            </span>
          }
        />
      ))}
      <More
        count={todos.length - MAX_ROWS}
        href={moduleHref("whiteboard-today")}
      />
    </List>
  );
}

function AgentBlock() {
  return (
    <div className="h-[34rem] overflow-hidden rounded-lg border">
      <AgentPanel variant="docked" allowBackground />
    </div>
  );
}

/* ───────────── Work ───────────── */

function TasksBlock() {
  const { moduleHref } = useWorkspaceNav();
  const upcoming = useUpcomingTasks();
  const cards = useMemo(
    () =>
      (upcoming.data?.boards ?? [])
        .flatMap((board) =>
          board.cards.map((card) => ({
            ...card,
            boardTitle: board.boardTitle,
            boardColor: board.boardColor,
          })),
        )
        .sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    [upcoming.data],
  );
  if (upcoming.error) return <Failed error={upcoming.error} />;
  if (!upcoming.data) return <RowsSkeleton />;
  if (cards.length === 0)
    return <EmptyState compact label="Nothing due this week" />;
  return (
    <List>
      {cards.slice(0, MAX_ROWS).map((card) => (
        <ListRow
          key={card._id}
          leading={
            <span
              className="size-2 rounded-full"
              style={{
                backgroundColor: card.boardColor ?? "var(--muted-foreground)",
              }}
            />
          }
          title={card.title}
          description={card.boardTitle}
          meta={
            <span className={cn(card.overdue && "text-destructive")}>
              {dueLabel(card.daysUntilDue, card.overdue)}
            </span>
          }
        />
      ))}
      <More count={cards.length - MAX_ROWS} href={moduleHref("kanban")} />
    </List>
  );
}

function SemesterBlock() {
  const semester = useSemesterOverview();
  if (semester.error) return <Failed error={semester.error} />;
  if (!semester.data) return <RowsSkeleton />;
  const { stats, deadlines } = semester.data;
  if (stats.activeCourses === 0)
    return <EmptyState compact label="No active courses" />;
  return (
    <div className="flex flex-col gap-4">
      <StatGroup className="sm:grid-cols-3">
        <Stat
          label="Overdue"
          value={stats.overdue}
          tone={stats.overdue > 0 ? "critical" : "default"}
        />
        <Stat label="Due 7d" value={stats.dueNext7Days} />
        <Stat
          label="Average"
          value={
            stats.semesterAverage === null
              ? "—"
              : `${stats.semesterAverage.toFixed(1)}%`
          }
        />
      </StatGroup>
      {deadlines.length ? (
        <List>
          {deadlines.slice(0, MAX_ROWS - 1).map((deadline) => {
            const days = Math.ceil(
              (Date.parse(deadline.dueAt) - Date.now()) / 86_400_000,
            );
            return (
              <ListRow
                key={deadline._id}
                title={deadline.title}
                description={deadline.courseCode ?? deadline.courseName}
                meta={
                  <span className={cn(deadline.overdue && "text-destructive")}>
                    {dueLabel(days, deadline.overdue)}
                  </span>
                }
              />
            );
          })}
        </List>
      ) : null}
    </div>
  );
}

function NotesBlock() {
  const { moduleHref } = useWorkspaceNav();
  const notesHref = moduleHref("notes");
  const stats = useDashboardStats();
  if (stats.error) return <Failed error={stats.error} />;
  if (!stats.data) return <RowsSkeleton />;
  const notes = stats.data.notes.recent;
  if (notes.length === 0) return <EmptyState compact label="No notes" />;
  return (
    <List>
      {notes.slice(0, MAX_ROWS).map((note) => (
        <MaybeLink
          key={note._id}
          href={
            notesHref && `${notesHref}?note=${encodeURIComponent(note._id)}`
          }
        >
          <ListRow
            title={note.title || "Untitled"}
            meta={formatDistanceToNowStrict(new Date(note.updatedAt))}
          />
        </MaybeLink>
      ))}
    </List>
  );
}

function ContactsBlock() {
  const stats = useDashboardStats();
  if (stats.error) return <Failed error={stats.error} />;
  if (!stats.data) return <RowsSkeleton />;
  const contacts = stats.data.contacts.recent;
  if (contacts.length === 0) return <EmptyState compact label="No contacts" />;
  return (
    <List>
      {contacts.slice(0, MAX_ROWS).map((contact) => (
        <ListRow
          key={contact._id}
          leading={
            <StatusDot
              tone={contact.status === "pending" ? "warning" : "muted"}
              label={contact.status}
            />
          }
          title={contact.name}
          description={contact.email}
          meta={formatDistanceToNowStrict(new Date(contact.createdAt))}
        />
      ))}
    </List>
  );
}

/* ───────────── Money ───────────── */

function BudgetBlock() {
  const today = useDashboardToday();
  if (today.error) return <Failed error={today.error} />;
  if (!today.data) return <RowsSkeleton rows={2} />;
  const budget = today.data.budget;
  if (!budget) return <EmptyState compact label="No budget" />;
  const ratio =
    budget.plannedMinor > 0 ? budget.spentMinor / budget.plannedMinor : 0;
  return (
    <div className="flex flex-col gap-3">
      <Stat
        label="Available"
        value={formatMinor(budget.availableMinor, budget.currency)}
        tone={budget.availableMinor < 0 ? "critical" : "default"}
      />
      <Meter
        value={ratio}
        tone={ratio > 1 ? "critical" : ratio > 0.85 ? "warning" : "default"}
      />
      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{formatMinor(budget.spentMinor, budget.currency)} spent</span>
        <span>{formatMinor(budget.plannedMinor, budget.currency)} planned</span>
      </div>
    </div>
  );
}

const SEVERITY_TONE: Record<"info" | "warning" | "critical", StatusTone> = {
  info: "muted",
  warning: "warning",
  critical: "critical",
};

function AlertsBlock() {
  const { routes } = useWorkspaceNav();
  const alerts = useBudgetAlerts();
  if (alerts.error) return <Failed error={alerts.error} />;
  if (!alerts.data) return <RowsSkeleton rows={3} />;
  if (alerts.data.length === 0)
    return <EmptyState compact label="No open alerts" />;
  return (
    <List>
      {alerts.data.slice(0, MAX_ROWS).map((alert) => (
        <ListRow
          key={alert.id}
          leading={
            <StatusDot
              tone={SEVERITY_TONE[alert.severity]}
              label={alert.severity}
            />
          }
          title={alert.title}
          description={alert.detail}
          meta={formatDistanceToNowStrict(new Date(alert.firstSeenAt))}
        />
      ))}
      <More
        count={alerts.data.length - MAX_ROWS}
        href={`${routes.finance.root}/alerts`}
      />
    </List>
  );
}

/* ───────────── System ───────────── */

const HEALTH_TONE = {
  healthy: "good",
  degraded: "warning",
  unreachable: "critical",
} as const satisfies Record<string, StatusTone>;

function ResourcesBlock() {
  const today = useDashboardToday();
  if (today.error) return <Failed error={today.error} />;
  if (!today.data) return <RowsSkeleton />;
  const resources = today.data.resources;
  if (resources.length === 0)
    return <EmptyState compact label="No resources" />;
  const healthy = resources.filter((r) => r.status === "healthy").length;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs tabular-nums text-muted-foreground">
        {healthy}/{resources.length} healthy
      </span>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-1.5">
        {resources.map((resource) => (
          <span
            key={resource.id}
            className="flex min-w-0 items-center gap-2 text-sm"
          >
            <StatusDot
              tone={resource.status ? HEALTH_TONE[resource.status] : "muted"}
              label={resource.status ?? "unknown"}
            />
            <span className="truncate text-accent-strong">{resource.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function LlmBlock() {
  const today = useDashboardToday();
  const stats = useDashboardStats();
  if (today.error) return <Failed error={today.error} />;
  if (!today.data) return <RowsSkeleton rows={2} />;
  return (
    <StatGroup className="sm:grid-cols-2">
      <Stat
        label="Today"
        value={`$${today.data.llm.todayUsd.toFixed(2)}`}
        hint={
          stats.data ? `${stats.data.llm.todayRequests} requests` : undefined
        }
      />
      <Stat
        label="This month"
        value={`$${today.data.llm.monthUsd.toFixed(2)}`}
      />
    </StatGroup>
  );
}

export function BlockBody({
  block,
  pageId,
  editing,
  onChange,
}: {
  block: Block;
  pageId: string;
  editing: boolean;
  onChange: (block: Block) => void;
}) {
  const shared = { pageId, editing };
  switch (block.type) {
    case "heading":
      return <HeadingBlock block={block} onChange={onChange} {...shared} />;
    case "text":
      return <TextBlock block={block} onChange={onChange} {...shared} />;
    case "divider":
      return <DividerBlock />;
    case "todo":
      return <TodoBlock block={block} onChange={onChange} {...shared} />;
    case "links":
      return <LinksBlock block={block} onChange={onChange} {...shared} />;
    case "subpages":
      return <SubpagesBlock block={block} onChange={onChange} {...shared} />;
    case "modules":
      return <ModulesBlock block={block} onChange={onChange} {...shared} />;
    case "greeting":
      return <GreetingBlock />;
    case "stats":
      return <StatsBlock />;
    case "agenda":
      return <AgendaBlock />;
    case "now":
      return <NowBlock />;
    case "board":
      return <BoardBlock />;
    case "agent":
      return <AgentBlock />;
    case "tasks":
      return <TasksBlock />;
    case "semester":
      return <SemesterBlock />;
    case "notes":
      return <NotesBlock />;
    case "contacts":
      return <ContactsBlock />;
    case "budget":
      return <BudgetBlock />;
    case "alerts":
      return <AlertsBlock />;
    case "resources":
      return <ResourcesBlock />;
    case "llm":
      return <LlmBlock />;
  }
}
