"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Calendar } from "@repo/ui/calendar";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/command";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageTitle } from "@repo/ui/page";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import { RowActions } from "@repo/ui/toolbar";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  Archive,
  BookOpen,
  CalendarDays,
  CalendarRange,
  Clock,
  Columns3,
  FileText,
  Flag,
  Link2,
  Plus,
  Tag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type {
  ICalendarEvent,
  ICourseListItem,
  IKanbanBoard,
  IKanbanCard,
  IKanbanCardLinks,
  IKanbanColumn,
  INoteGraph,
  IPersonGraph,
  KanbanCardLinkedEntityType,
  KanbanPriority,
} from "@/lib/data-types";
import { PRIORITY_BADGE } from "../_components/kanban-card-item";

type FullBoard = IKanbanBoard & {
  columns: (IKanbanColumn & { cards: IKanbanCard[] })[];
};
type LinkOption = { _id: string; name: string; subtitle?: string };
type LinkGroupKey = keyof IKanbanCardLinks;

/** Fields the card PATCH accepts. `null` clears a date. */
type CardPatch = {
  title?: string;
  description?: string;
  columnId?: string;
  priority?: KanbanPriority;
  labels?: string[];
  startDate?: string | null;
  dueDate?: string | null;
  hasDueTime?: boolean;
  isArchived?: boolean;
};

const LINK_CONFIG: Record<
  KanbanCardLinkedEntityType,
  { label: string; key: LinkGroupKey; icon: typeof Link2 }
> = {
  calendar: { label: "Event", key: "calendarEvents", icon: CalendarDays },
  note: { label: "Note", key: "notes", icon: FileText },
  person: { label: "Person", key: "people", icon: UserRound },
  course: { label: "Course", key: "courses", icon: BookOpen },
};

const LINK_TYPES: KanbanCardLinkedEntityType[] = [
  "calendar",
  "note",
  "person",
  "course",
];

const PRIORITIES: KanbanPriority[] = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
];

const FLUSH_TRIGGER =
  "-ml-2.5 border-transparent shadow-none hover:bg-surface/70 data-[state=open]:bg-surface/70";

function emptyLinks(): IKanbanCardLinks {
  return { calendarEvents: [], notes: [], people: [], courses: [] };
}

function isPriority(value: string): value is KanbanPriority {
  return PRIORITIES.some((priority) => priority === value);
}

function patchDate(
  current: Date | undefined,
  next: string | null | undefined,
): Date | undefined {
  if (next === undefined) return current;
  return next === null ? undefined : new Date(next);
}

function applyPatch(card: IKanbanCard, patch: CardPatch): IKanbanCard {
  const { startDate, dueDate, ...rest } = patch;
  return {
    ...card,
    ...rest,
    startDate: patchDate(card.startDate, startDate),
    dueDate: patchDate(card.dueDate, dueDate),
  };
}

function CardSkeleton() {
  return (
    <Page>
      <DashboardPageHeader title={<Skeleton className="h-4 w-40" />} />
      <PageBody>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="flex flex-col gap-2">
          {["w-32", "w-24", "w-40", "w-28"].map((width) => (
            <div key={width} className="grid grid-cols-[10rem_1fr] gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className={`h-4 ${width}`} />
            </div>
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
      </PageBody>
    </Page>
  );
}

function CardPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const boardId = params.get("board");
  const cardId = params.get("card");
  const { loading: settingsLoading } = useUserSettings();
  const API = useMemo(
    () => (settingsLoading ? null : new denizApi()),
    [settingsLoading],
  );
  const [board, setBoard] = useState<FullBoard | null>(null);
  const [card, setCard] = useState<IKanbanCard | null>(null);
  const [links, setLinks] = useState<IKanbanCardLinks>(emptyLinks);
  const [loading, setLoading] = useState(true);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pickerType, setPickerType] =
    useState<KanbanCardLinkedEntityType | null>(null);
  const [options, setOptions] = useState<
    Record<KanbanCardLinkedEntityType, LinkOption[]>
  >({ calendar: [], note: [], person: [], course: [] });

  const boardHref = boardId
    ? `/dashboard/kanban?board=${encodeURIComponent(boardId)}`
    : "/dashboard/kanban";

  const load = useCallback(async () => {
    if (!API || !boardId || !cardId) return;
    const [boardResult, cardResult] = await Promise.all([
      API.GET<{ board: FullBoard }>({ endpoint: `kanban/boards/${boardId}` }),
      API.GET<{ card: IKanbanCard; links: IKanbanCardLinks }>({
        endpoint: `kanban/boards/${boardId}/cards/${cardId}`,
      }),
    ]);
    if ("code" in boardResult || "code" in cardResult) {
      toast.error("Unable to load this card");
      setLoading(false);
      return;
    }
    setBoard(boardResult.board);
    setCard(cardResult.card);
    setTitleDraft(cardResult.card.title);
    setLinks(cardResult.links ?? emptyLinks());
    setLoading(false);
  }, [API, boardId, cardId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!API || !pickerType) return;
    const now = new Date();
    const start = new Date(
      now.getFullYear(),
      now.getMonth() - 6,
      1,
    ).toISOString();
    const end = new Date(
      now.getFullYear(),
      now.getMonth() + 12,
      0,
    ).toISOString();
    Promise.all([
      API.GET<{ events: ICalendarEvent[] }>({
        endpoint: `calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
      }),
      API.GET<INoteGraph>({ endpoint: "notes" }),
      API.GET<IPersonGraph>({ endpoint: "people" }),
      API.GET<{ courses: ICourseListItem[] }>({ endpoint: "courses" }),
    ]).then(([events, notes, people, courses]) => {
      setOptions({
        calendar:
          "code" in events
            ? []
            : events.events.map((event) => ({
                _id: event._id,
                name: event.title,
                subtitle: format(new Date(event.date), "d MMM yyyy"),
              })),
        note:
          "code" in notes
            ? []
            : notes.notes
                .filter((note) => note.status === "open")
                .map((note) => ({ _id: note._id, name: note.title })),
        person:
          "code" in people
            ? []
            : people.people.map((person) => ({
                _id: person._id,
                name: person.name,
              })),
        course:
          "code" in courses
            ? []
            : courses.courses.map((item) => ({
                _id: item.course._id,
                name: item.course.name,
                subtitle: item.course.code,
              })),
      });
    });
  }, [API, pickerType]);

  const updateCard = async (patch: CardPatch): Promise<boolean> => {
    if (!API || !boardId || !cardId || !card) return false;
    const previous = card;
    setCard(applyPatch(card, patch));
    const result = await API.PATCH<{ card: IKanbanCard }>({
      endpoint: `kanban/boards/${boardId}/cards/${cardId}`,
      body: patch,
    });
    if ("code" in result) {
      setCard(previous);
      toast.error(result.message);
      return false;
    }
    setCard(result.card);
    return true;
  };

  const addLink = async (
    type: KanbanCardLinkedEntityType,
    option: LinkOption,
  ) => {
    if (!API || !boardId || !cardId) return;
    const previous = links;
    const next: IKanbanCardLinks = { ...links };
    if (type === "calendar")
      next.calendarEvents = [
        ...links.calendarEvents,
        {
          _id: option._id,
          title: option.name,
          start: new Date().toISOString(),
        },
      ];
    else {
      const key = LINK_CONFIG[type].key;
      if (key !== "calendarEvents")
        next[key] = [...links[key], { _id: option._id, name: option.name }];
    }
    setLinks(next);
    setPickerType(null);
    const result = await API.POST<{ card: IKanbanCard }>({
      endpoint: `kanban/boards/${boardId}/cards/${cardId}/links`,
      body: { entityType: type, entityId: option._id },
    });
    if ("code" in result) {
      setLinks(previous);
      toast.error(result.message);
    }
  };

  const removeLink = async (
    type: KanbanCardLinkedEntityType,
    entityId: string,
  ) => {
    if (!API || !boardId || !cardId) return;
    const previous = links;
    const key = LINK_CONFIG[type].key;
    const next: IKanbanCardLinks = { ...links };
    if (key === "calendarEvents")
      next.calendarEvents = links.calendarEvents.filter(
        (entry) => entry._id !== entityId,
      );
    else next[key] = links[key].filter((entry) => entry._id !== entityId);
    setLinks(next);
    const result = await API.DELETE<{ card: IKanbanCard }>({
      endpoint: `kanban/boards/${boardId}/cards/${cardId}/links?entityType=${type}&entityId=${encodeURIComponent(entityId)}`,
    });
    if ("code" in result) {
      setLinks(previous);
      toast.error(result.message);
    }
  };

  const openLinkedEntity = (type: KanbanCardLinkedEntityType, id: string) => {
    if (type === "note")
      router.push(`/dashboard/notes?note=${encodeURIComponent(id)}`);
    else if (type === "person")
      router.push(`/dashboard/people?person=${encodeURIComponent(id)}`);
    else if (type === "course")
      router.push(`/dashboard/courses/edit?id=${encodeURIComponent(id)}`);
    else router.push("/dashboard/calendar");
  };

  const addLabel = () => {
    if (!card) return;
    const label = labelInput.trim();
    if (!label) return;
    setLabelInput("");
    if (
      card.labels.some(
        (existing) => existing.toLowerCase() === label.toLowerCase(),
      )
    )
      return;
    void updateCard({ labels: [...card.labels, label] });
  };

  const commitTitle = () => {
    if (!card) return;
    const next = titleDraft.trim();
    if (!next) {
      setTitleDraft(card.title);
      return;
    }
    if (next !== card.title) void updateCard({ title: next });
  };

  const setDueDate = (date: Date | undefined) => {
    if (!card) return;
    if (!date) {
      void updateCard({ dueDate: null, hasDueTime: false });
      return;
    }
    // Picking a new day keeps the time already set on the card.
    if (card.dueDate && card.hasDueTime) {
      const previous = new Date(card.dueDate);
      date.setHours(previous.getHours(), previous.getMinutes(), 0, 0);
    }
    void updateCard({ dueDate: date.toISOString() });
  };

  const setDueTime = (value: string) => {
    if (!card?.dueDate || !value) return;
    const [hours, minutes] = value.split(":").map(Number);
    const next = new Date(card.dueDate);
    next.setHours(hours, minutes, 0, 0);
    void updateCard({ dueDate: next.toISOString(), hasDueTime: true });
  };

  if (!boardId || !cardId)
    return (
      <Page>
        <DashboardPageHeader
          crumbs={[
            {
              label: "Kanban",
              onClick: () => router.push("/dashboard/kanban"),
            },
          ]}
          title="Card"
        />
        <EmptyState icon={<Columns3 />} label="No card" />
      </Page>
    );
  if (loading) return <CardSkeleton />;
  if (!card || !board)
    return (
      <Page>
        <DashboardPageHeader
          crumbs={[{ label: "Kanban", onClick: () => router.push(boardHref) }]}
          title="Card"
        />
        <EmptyState icon={<Columns3 />} label="Card not found" />
      </Page>
    );

  const column = board.columns.find((c) => c._id === card.columnId);
  const linkCount = Object.values(links).reduce(
    (count, group) => count + group.length,
    0,
  );
  const linkRows = LINK_TYPES.flatMap((type) => {
    const config = LINK_CONFIG[type];
    return config.key === "calendarEvents"
      ? links.calendarEvents.map((entry) => ({
          type,
          id: entry._id,
          name: entry.title,
        }))
      : links[config.key].map((entry) => ({
          type,
          id: entry._id,
          name: entry.name,
        }));
  });

  return (
    <Page>
      <DashboardPageHeader
        crumbs={[
          { label: "Kanban", onClick: () => router.push("/dashboard/kanban") },
          { label: board.title, onClick: () => router.push(boardHref) },
        ]}
        title={card.title}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (await updateCard({ isArchived: true })) router.push(boardHref);
          }}
        >
          <Archive /> Archive
        </Button>
        <RowActions label="Card actions">
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 /> Delete
          </DropdownMenuItem>
        </RowActions>
      </DashboardPageHeader>

      <PageBody>
        <PageTitle
          title={
            <input
              aria-label="Title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setTitleDraft(card.title);
                  e.currentTarget.blur();
                }
              }}
              className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
            />
          }
          meta={
            <>
              <span>{column?.title ?? "—"}</span>
              <span>
                created{" "}
                {formatDistanceToNowStrict(new Date(card.createdAt), {
                  addSuffix: true,
                })}
              </span>
              <span>
                updated{" "}
                {formatDistanceToNowStrict(new Date(card.updatedAt), {
                  addSuffix: true,
                })}
              </span>
            </>
          }
        />

        <Properties>
          <Property icon={<Columns3 />} label="Column">
            <Select
              value={card.columnId}
              onValueChange={(columnId) => void updateCard({ columnId })}
            >
              <SelectTrigger className={FLUSH_TRIGGER}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {board.columns.map((option) => (
                  <SelectItem key={option._id} value={option._id}>
                    {option.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Property>
          <Property icon={<Flag />} label="Priority">
            <Select
              value={card.priority}
              onValueChange={(priority) => {
                if (isPriority(priority)) void updateCard({ priority });
              }}
            >
              <SelectTrigger className={FLUSH_TRIGGER}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((priority) => {
                  const badge = PRIORITY_BADGE[priority];
                  return (
                    <SelectItem key={priority} value={priority}>
                      {badge ? (
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      ) : (
                        "None"
                      )}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Property>
          <Property icon={<Tag />} label="Labels">
            <div className="flex min-h-8 flex-wrap items-center gap-1.5">
              {card.labels.map((label) => (
                <Badge key={label} variant="secondary" className="pr-0.5">
                  {label}
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:text-accent-strong"
                    onClick={() =>
                      void updateCard({
                        labels: card.labels.filter((l) => l !== label),
                      })
                    }
                    aria-label={`Remove ${label}`}
                  >
                    <X />
                  </button>
                </Badge>
              ))}
              <input
                aria-label="Add label"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addLabel();
                  }
                }}
                onBlur={addLabel}
                placeholder={card.labels.length ? "" : "Empty"}
                className="h-7 min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </Property>
          <Property icon={<CalendarRange />} label="Start">
            <DateValue
              label="start date"
              value={card.startDate}
              onChange={(date) =>
                void updateCard({ startDate: date?.toISOString() ?? null })
              }
            />
          </Property>
          <Property icon={<CalendarDays />} label="Due">
            <div className="flex items-center gap-3">
              <DateValue
                label="due date"
                value={card.dueDate}
                onChange={setDueDate}
              />
              {card.dueDate && card.hasDueTime && (
                <Input
                  type="time"
                  aria-label="Due time"
                  value={format(new Date(card.dueDate), "HH:mm")}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="h-7 w-28"
                />
              )}
            </div>
          </Property>
          <Property icon={<Clock />} label="Due time">
            <Switch
              aria-label="Due time"
              checked={card.hasDueTime ?? false}
              disabled={!card.dueDate}
              onCheckedChange={(hasDueTime) => void updateCard({ hasDueTime })}
            />
          </Property>
        </Properties>

        <Section title="Description">
          {editingDescription ? (
            <Textarea
              autoFocus
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onBlur={() => {
                setEditingDescription(false);
                if (descriptionDraft !== (card.description ?? ""))
                  void updateCard({ description: descriptionDraft });
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDescriptionDraft(card.description ?? "");
                  e.currentTarget.blur();
                }
              }}
              className="min-h-64 resize-y font-mono text-[13px] leading-relaxed"
            />
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label="Edit description"
              className="-mx-2 min-h-24 cursor-text rounded-md px-2 py-1.5 transition-colors hover:bg-surface/50 focus-visible:bg-surface/50 focus-visible:outline-none"
              onClick={() => {
                setDescriptionDraft(card.description ?? "");
                setEditingDescription(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setDescriptionDraft(card.description ?? "");
                  setEditingDescription(true);
                }
              }}
            >
              {card.description ? (
                <div className="prose prose-sm max-w-none text-foreground dark:prose-invert prose-pre:overflow-x-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {card.description}
                  </ReactMarkdown>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Empty</span>
              )}
            </div>
          )}
        </Section>

        <Section
          title="Links"
          count={linkCount}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add link"
                  className="text-muted-foreground"
                >
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {LINK_TYPES.map((type) => {
                  const { icon: Icon, label } = LINK_CONFIG[type];
                  return (
                    <DropdownMenuItem
                      key={type}
                      onClick={() => setPickerType(type)}
                    >
                      <Icon /> {label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        >
          {linkRows.length === 0 ? (
            <EmptyState compact icon={<Link2 />} label="No links" />
          ) : (
            <List>
              {linkRows.map((row) => {
                const Icon = LINK_CONFIG[row.type].icon;
                return (
                  <ListRow
                    key={`${row.type}:${row.id}`}
                    leading={<Icon />}
                    title={row.name}
                    meta={LINK_CONFIG[row.type].label}
                    onClick={() => openLinkedEntity(row.type, row.id)}
                    trailing={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${row.name}`}
                        className="text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeLink(row.type, row.id);
                        }}
                      >
                        <X />
                      </Button>
                    }
                  />
                );
              })}
            </List>
          )}
        </Section>
      </PageBody>

      <CommandDialog
        open={pickerType !== null}
        onOpenChange={(open) => !open && setPickerType(null)}
        title={pickerType ? `Link ${LINK_CONFIG[pickerType].label}` : "Link"}
        description="Search"
      >
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandEmpty>0 results</CommandEmpty>
          <CommandGroup>
            {pickerType &&
              options[pickerType]
                .filter(
                  (option) =>
                    !linkRows.some(
                      (row) => row.type === pickerType && row.id === option._id,
                    ),
                )
                .map((option) => (
                  <CommandItem
                    key={option._id}
                    value={`${option.name} ${option.subtitle ?? ""} ${option._id}`}
                    onSelect={() => void addLink(pickerType, option)}
                  >
                    <span className="flex-1 truncate">{option.name}</span>
                    {option.subtitle && (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {option.subtitle}
                      </span>
                    )}
                  </CommandItem>
                ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${card.title}?`}
        actionLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!API) return;
          const result = await API.DELETE<{ success: true }>({
            endpoint: `kanban/boards/${boardId}/cards/${cardId}`,
          });
          if ("code" in result) {
            toast.error("Failed to delete card");
            return;
          }
          router.push(boardHref);
        }}
      />
    </Page>
  );
}

function DateValue({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: Date | string;
  onChange: (date?: Date) => void;
}) {
  return (
    <div className="group/date flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="-ml-2.5 font-normal data-[state=open]:bg-surface/70"
            aria-label={`Set ${label}`}
          >
            {value ? (
              <span className="tabular-nums text-accent-strong">
                {format(new Date(value), "EEE d MMM yyyy")}
              </span>
            ) : (
              <span className="text-muted-foreground">Empty</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value ? new Date(value) : undefined}
            onSelect={onChange}
          />
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground opacity-0 group-hover/date:opacity-100 focus-visible:opacity-100"
          onClick={() => onChange(undefined)}
          aria-label={`Clear ${label}`}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

export default function KanbanCardPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <CardPageInner />
    </Suspense>
  );
}
