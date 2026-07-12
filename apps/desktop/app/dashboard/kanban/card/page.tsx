"use client";

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
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import { format } from "date-fns";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  FileText,
  Link2,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
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

type FullBoard = IKanbanBoard & {
  columns: (IKanbanColumn & { cards: IKanbanCard[] })[];
};
type LinkOption = { _id: string; name: string; subtitle?: string };
type LinkGroupKey = keyof IKanbanCardLinks;

const LINK_CONFIG: Record<
  KanbanCardLinkedEntityType,
  { label: string; key: LinkGroupKey; icon: typeof Link2 }
> = {
  calendar: { label: "Events", key: "calendarEvents", icon: CalendarDays },
  note: { label: "Notes", key: "notes", icon: FileText },
  person: { label: "People", key: "people", icon: UserRound },
  course: { label: "Courses", key: "courses", icon: BookOpen },
};

function emptyLinks(): IKanbanCardLinks {
  return { calendarEvents: [], notes: [], people: [], courses: [] };
}

function CardPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const boardId = params.get("board");
  const cardId = params.get("card");
  const { settings, loading: settingsLoading } = useUserSettings();
  const API = useMemo(
    () => (settingsLoading ? null : new denizApi(settings.apiKey)),
    [settings.apiKey, settingsLoading],
  );
  const [board, setBoard] = useState<FullBoard | null>(null);
  const [card, setCard] = useState<IKanbanCard | null>(null);
  const [links, setLinks] = useState<IKanbanCardLinks>(emptyLinks);
  const [loading, setLoading] = useState(true);
  const [editingDescription, setEditingDescription] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [pickerType, setPickerType] =
    useState<KanbanCardLinkedEntityType | null>(null);
  const [options, setOptions] = useState<
    Record<KanbanCardLinkedEntityType, LinkOption[]>
  >({ calendar: [], note: [], person: [], course: [] });

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

  const updateCard = async (patch: Record<string, unknown>) => {
    if (!API || !boardId || !cardId || !card) return;
    const previous = card;
    setCard({ ...card, ...patch } as IKanbanCard);
    const result = await API.PATCH<{ card: IKanbanCard }>({
      endpoint: `kanban/boards/${boardId}/cards/${cardId}`,
      body: patch,
    });
    if ("code" in result) {
      setCard(previous);
      toast.error(result.message);
      return;
    }
    setCard(result.card);
  };

  const addLink = async (
    type: KanbanCardLinkedEntityType,
    option: LinkOption,
  ) => {
    if (!API || !boardId || !cardId) return;
    const config = LINK_CONFIG[type];
    const previous = links;
    const entry =
      type === "calendar"
        ? {
            _id: option._id,
            title: option.name,
            start: new Date().toISOString(),
          }
        : { _id: option._id, name: option.name };
    setLinks({
      ...links,
      [config.key]: [...links[config.key], entry],
    } as IKanbanCardLinks);
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
    const config = LINK_CONFIG[type];
    const previous = links;
    setLinks({
      ...links,
      [config.key]: links[config.key].filter((entry) => entry._id !== entityId),
    } as IKanbanCardLinks);
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
    ) {
      return;
    }
    void updateCard({ labels: [...card.labels, label] });
  };

  const removeLabel = (label: string) => {
    if (!card) return;
    void updateCard({
      labels: card.labels.filter((existing) => existing !== label),
    });
  };

  if (!boardId || !cardId)
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        Choose a card from a kanban board.
      </div>
    );
  if (loading || !card || !board)
    return <div className="h-full animate-pulse bg-muted/20" />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() =>
            router.push(
              `/dashboard/kanban?board=${encodeURIComponent(boardId)}`,
            )
          }
        >
          <ArrowLeft className="size-4" />
        </Button>
        <span className="truncate text-xs text-muted-foreground">
          {board.title}
        </span>
        <span className="text-muted-foreground/50">/</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {card.title}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void updateCard({ isArchived: true }).then(() =>
              router.push("/dashboard/kanban"),
            )
          }
        >
          <Archive className="size-3.5" /> Archive
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive"
          onClick={async () => {
            if (!API) return;
            const result = await API.DELETE<{ success: true }>({
              endpoint: `kanban/boards/${boardId}/cards/${cardId}`,
            });
            if (!("code" in result)) router.push("/dashboard/kanban");
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="min-w-0 space-y-8">
            <Input
              value={card.title}
              onChange={(e) => setCard({ ...card, title: e.target.value })}
              onBlur={(e) =>
                void updateCard({ title: e.target.value.trim() || "Untitled" })
              }
              className="h-auto border-0 px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
            />
            <div>
              <Label className="mb-2 block text-xs text-muted-foreground">
                Description · Markdown
              </Label>
              {editingDescription ? (
                <Textarea
                  autoFocus
                  value={card.description ?? ""}
                  onChange={(e) =>
                    setCard({ ...card, description: e.target.value })
                  }
                  onBlur={(e) => {
                    void updateCard({ description: e.target.value });
                    setEditingDescription(false);
                  }}
                  placeholder="Add context, links, or a checklist…"
                  className="min-h-64 resize-y border-0 bg-muted/30 px-4 py-3 leading-relaxed shadow-none"
                />
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  className="min-h-64 w-full rounded-md bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setEditingDescription(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setEditingDescription(true);
                    }
                  }}
                  aria-label="Edit description"
                >
                  {card.description ? (
                    <div className="prose prose-sm max-w-none text-foreground dark:prose-invert prose-a:text-primary prose-pre:overflow-x-auto">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {card.description}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Click to add a description.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Attachments</h2>
                <span className="text-xs text-muted-foreground">
                  {Object.values(links).reduce(
                    (count, group) => count + group.length,
                    0,
                  )}{" "}
                  linked
                </span>
              </div>
              {(Object.keys(LINK_CONFIG) as KanbanCardLinkedEntityType[]).map(
                (type) => {
                  const config = LINK_CONFIG[type];
                  const Icon = config.icon;
                  const group = links[config.key];
                  return (
                    <div key={type} className="border-t border-border/70 py-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Icon className="size-4 text-muted-foreground" />
                        <h3 className="flex-1 text-xs font-medium">
                          {config.label}
                        </h3>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          onClick={() => setPickerType(type)}
                        >
                          <Plus className="size-3.5" /> Add
                        </Button>
                      </div>
                      {group.length === 0 ? (
                        <p className="pl-6 text-xs text-muted-foreground">
                          None linked
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {group.map((entry) => {
                            const name =
                              "title" in entry ? entry.title : entry.name;
                            return (
                              <div
                                key={entry._id}
                                className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
                              >
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 truncate text-left text-sm"
                                  onClick={() =>
                                    openLinkedEntity(type, entry._id)
                                  }
                                >
                                  {name}
                                </button>
                                <button
                                  type="button"
                                  className="opacity-0 text-muted-foreground hover:text-destructive group-hover:opacity-100"
                                  onClick={() =>
                                    void removeLink(type, entry._id)
                                  }
                                  aria-label={`Remove ${name}`}
                                >
                                  <X className="size-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                },
              )}
            </div>
          </section>

          <aside className="space-y-5 lg:border-l lg:pl-6">
            <h2 className="text-sm font-semibold">Details</h2>
            <div className="space-y-1.5">
              <Label>Column</Label>
              <Select
                value={card.columnId}
                onValueChange={(columnId) => void updateCard({ columnId })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {board.columns.map((column) => (
                    <SelectItem key={column._id} value={column._id}>
                      {column.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                value={card.priority}
                onValueChange={(priority) =>
                  void updateCard({ priority: priority as KanbanPriority })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["none", "low", "medium", "high", "urgent"].map(
                    (priority) => (
                      <SelectItem key={priority} value={priority}>
                        {priority[0].toUpperCase() + priority.slice(1)}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-label">Labels</Label>
              {card.labels.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {card.labels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-2 pr-1 text-xs font-medium text-primary"
                    >
                      {label}
                      <button
                        type="button"
                        className="rounded-full p-0.5 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => removeLabel(label)}
                        aria-label={`Remove ${label}`}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Input
                id="card-label"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addLabel();
                  }
                }}
                onBlur={addLabel}
                placeholder="Type a label and press Enter"
              />
            </div>
            <DateField
              label="Start date"
              value={card.startDate}
              onChange={(date) =>
                void updateCard({ startDate: date?.toISOString() ?? null })
              }
            />
            <DateField
              label="Due date"
              value={card.dueDate}
              onChange={(date) =>
                void updateCard({ dueDate: date?.toISOString() ?? null })
              }
            />
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="due-time">Include time</Label>
                <p className="text-xs text-muted-foreground">
                  Treat the due time as exact.
                </p>
              </div>
              <Switch
                id="due-time"
                checked={card.hasDueTime ?? false}
                disabled={!card.dueDate}
                onCheckedChange={(hasDueTime) =>
                  void updateCard({ hasDueTime })
                }
              />
            </div>
            {card.dueDate && card.hasDueTime && (
              <Input
                type="time"
                value={format(new Date(card.dueDate), "HH:mm")}
                onChange={(e) => {
                  const [hours, minutes] = e.target.value
                    .split(":")
                    .map(Number);
                  const next = new Date(card.dueDate!);
                  next.setHours(hours, minutes, 0, 0);
                  void updateCard({
                    dueDate: next.toISOString(),
                    hasDueTime: true,
                  });
                }}
              />
            )}
          </aside>
        </div>
      </main>

      <CommandDialog
        open={pickerType !== null}
        onOpenChange={(open) => !open && setPickerType(null)}
        title={`Add ${pickerType ? LINK_CONFIG[pickerType].label : "attachment"}`}
        description="Search for an entity to link"
      >
        <CommandInput placeholder="Search…" />
        <CommandList>
          <CommandEmpty>No matches found.</CommandEmpty>
          <CommandGroup>
            {pickerType &&
              options[pickerType]
                .filter(
                  (option) =>
                    !links[LINK_CONFIG[pickerType].key].some(
                      (entry) => entry._id === option._id,
                    ),
                )
                .map((option) => (
                  <CommandItem
                    key={option._id}
                    value={`${option.name} ${option.subtitle ?? ""}`}
                    onSelect={() => void addLink(pickerType, option)}
                  >
                    <Link2 className="size-4" />
                    <span className="flex-1 truncate">{option.name}</span>
                    {option.subtitle && (
                      <span className="text-xs text-muted-foreground">
                        {option.subtitle}
                      </span>
                    )}
                  </CommandItem>
                ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: Date | string;
  onChange: (date?: Date) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="flex-1 justify-start font-normal"
            >
              <CalendarDays className="size-4" />
              {value ? format(new Date(value), "d MMM yyyy") : "Choose date"}
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
            size="icon"
            onClick={() => onChange(undefined)}
            aria-label={`Clear ${label}`}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default function KanbanCardPage() {
  return (
    <Suspense fallback={<div className="h-full animate-pulse bg-muted/20" />}>
      <CardPageInner />
    </Suspense>
  );
}
