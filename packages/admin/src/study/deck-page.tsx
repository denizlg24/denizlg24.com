"use client";

import type { Flashcard } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import {
  Page,
  PageBody,
  PageHeader,
  PageTitle,
  PageToolbar,
} from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { Textarea } from "@repo/ui/textarea";
import {
  FilterTabs,
  RowActions,
  SearchField,
  ToolbarSpacer,
} from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { Layers3, Plus, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { DeckDialog } from "./notebook-artifacts";
import {
  createCards,
  type DeckDetail,
  deleteCard,
  deleteDeck,
  getDeck,
  updateCard,
} from "./study-api";
import {
  errorMessage,
  openStudySource,
  relativeTime,
  withParam,
} from "./study-format";

type Filter = "all" | "due" | "new" | "stale" | "suspended";

function isDueNow(card: Flashcard, now: number): boolean {
  return card.fsrs.state !== "new" && new Date(card.fsrs.due).getTime() <= now;
}

function CardEditor({
  initialFront = "",
  initialBack = "",
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialFront?: string;
  initialBack?: string;
  submitLabel: string;
  onSubmit: (front: string, back: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [front, setFront] = useState(initialFront);
  const [back, setBack] = useState(initialBack);
  const [pending, setPending] = useState(false);
  const valid = Boolean(front.trim() && back.trim());

  const submit = async () => {
    if (!valid || pending) return;
    setPending(true);
    const done = await onSubmit(front.trim(), back.trim());
    setPending(false);
    if (done && !initialFront) {
      setFront("");
      setBack("");
    }
  };

  return (
    <form
      className="flex flex-col gap-2 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit();
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Textarea
          value={front}
          rows={3}
          autoFocus
          aria-label="Front"
          placeholder="Front"
          onChange={(event) => setFront(event.target.value)}
        />
        <Textarea
          value={back}
          rows={3}
          aria-label="Back"
          placeholder="Back"
          onChange={(event) => setBack(event.target.value)}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!valid || pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function CardRow({
  card,
  editing,
  onEdit,
  onSave,
  onCancel,
  onToggleSuspend,
  onDelete,
  onOpenSource,
}: {
  card: Flashcard;
  editing: boolean;
  onEdit: () => void;
  onSave: (front: string, back: string) => Promise<boolean>;
  onCancel: () => void;
  onToggleSuspend: () => void;
  onDelete: () => void;
  onOpenSource: () => void;
}) {
  if (editing) {
    return (
      <li className="border-b border-border/70">
        <CardEditor
          initialFront={card.front}
          initialBack={card.back}
          submitLabel="Save"
          onSubmit={onSave}
          onCancel={onCancel}
        />
      </li>
    );
  }
  return (
    <li
      className={cn(
        "group/card -mx-2 grid grid-cols-1 gap-x-6 gap-y-1 rounded-md border-b border-border/70 px-2 py-2.5 sm:grid-cols-[1fr_1fr_auto]",
        card.suspended && "opacity-55",
      )}
    >
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 whitespace-pre-wrap text-left text-sm text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {card.front}
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 whitespace-pre-wrap text-left text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {card.back}
      </button>
      <div className="flex items-start justify-end gap-2 text-xs tabular-nums text-muted-foreground">
        {card.stale ? <Badge variant="warning">stale</Badge> : null}
        {card.suspended ? <Badge variant="secondary">suspended</Badge> : null}
        <span className="w-14 text-right capitalize">
          {card.fsrs.state === "new" ? "new" : relativeTime(card.fsrs.due)}
        </span>
        <RowActions>
          <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
          {card.sources.length > 0 ? (
            <DropdownMenuItem onSelect={onOpenSource}>Source</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={onToggleSuspend}>
            {card.suspended ? "Unsuspend" : "Suspend"}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        </RowActions>
      </div>
    </li>
  );
}

function DeckSkeleton({ notebookId }: { notebookId: string }) {
  const { slots, routes } = useAdmin();
  const router = useRouter();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        crumbs={[
          {
            label: "Notebook",
            onClick: () => router.push(routes.study.notebook(notebookId)),
          },
        ]}
        icon={<Layers3 />}
        title={<Skeleton className="h-4 w-32" />}
      />
      <PageBody>
        <Skeleton className="h-7 w-1/3" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="grid grid-cols-2 gap-6 py-1">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ))}
        </div>
      </PageBody>
    </Page>
  );
}

export function DeckPage({
  notebookId,
  deckId,
}: {
  notebookId: string;
  deckId: string;
}) {
  const admin = useAdmin();
  const { client, routes, slots } = admin;
  const router = useRouter();
  const [detail, setDetail] = useState<DeckDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [editingDeck, setEditingDeck] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setDetail(await getDeck(client, deckId, { signal }));
      } catch (error) {
        if (signal?.aborted) return;
        setFailed(true);
        toast.error(errorMessage(error, "Failed to load deck"));
      }
    },
    [client, deckId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const visible = useMemo(() => {
    if (!detail) return [];
    const now = Date.now();
    const needle = query.trim().toLowerCase();
    return detail.cards.filter((card) => {
      if (
        needle &&
        !`${card.front}\n${card.back}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      switch (filter) {
        case "due":
          return !card.suspended && isDueNow(card, now);
        case "new":
          return card.fsrs.state === "new";
        case "stale":
          return card.stale;
        case "suspended":
          return card.suspended;
        default:
          return true;
      }
    });
  }, [detail, filter, query]);

  if (!detail) {
    if (failed) {
      return (
        <Page>
          <PageHeader
            leading={slots?.sidebarTrigger}
            crumbs={[
              {
                label: "Notebook",
                onClick: () => router.push(routes.study.notebook(notebookId)),
              },
            ]}
            icon={<Layers3 />}
            title="Deck"
          />
          <p className="py-16 text-center text-sm text-muted-foreground">—</p>
        </Page>
      );
    }
    return <DeckSkeleton notebookId={notebookId} />;
  }

  const { deck, cards } = detail;
  const staleCount = cards.filter((card) => card.stale).length;
  const suspendedCount = cards.filter((card) => card.suspended).length;

  const replaceCard = (next: Flashcard) =>
    setDetail((current) =>
      current
        ? {
            ...current,
            cards: current.cards.map((card) =>
              card._id === next._id ? next : card,
            ),
          }
        : current,
    );

  const add = async (front: string, back: string) => {
    try {
      const created = await createCards(client, {
        deckId,
        cards: [{ front, back }],
      });
      setDetail((current) =>
        current
          ? {
              deck: {
                ...current.deck,
                cardCount: current.deck.cardCount + created.length,
                newCount: current.deck.newCount + created.length,
              },
              cards: [...created, ...current.cards],
            }
          : current,
      );
      return true;
    } catch (error) {
      toast.error(errorMessage(error, "Failed to add card"));
      return false;
    }
  };

  const save = async (card: Flashcard, front: string, back: string) => {
    try {
      replaceCard(await updateCard(client, card._id, { front, back }));
      setEditingId(null);
      return true;
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save card"));
      return false;
    }
  };

  const toggleSuspend = async (card: Flashcard) => {
    replaceCard({ ...card, suspended: !card.suspended });
    try {
      replaceCard(
        await updateCard(client, card._id, { suspended: !card.suspended }),
      );
    } catch (error) {
      replaceCard(card);
      toast.error(errorMessage(error, "Failed to update card"));
    }
  };

  const remove = async (card: Flashcard) => {
    const previous = detail;
    setDetail({
      deck: { ...deck, cardCount: deck.cardCount - 1 },
      cards: cards.filter((entry) => entry._id !== card._id),
    });
    try {
      await deleteCard(client, card._id);
    } catch (error) {
      setDetail(previous);
      toast.error(errorMessage(error, "Failed to delete card"));
    }
  };

  const removeDeck = async () => {
    try {
      await deleteDeck(client, deckId);
      router.push(withParam(routes.study.notebook(notebookId), "tab", "decks"));
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete deck"));
    }
  };

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        crumbs={[
          { label: "Study", onClick: () => router.push(routes.study.index) },
          {
            label: "Decks",
            onClick: () =>
              router.push(
                withParam(routes.study.notebook(notebookId), "tab", "decks"),
              ),
          },
        ]}
        icon={<Layers3 />}
        title={deck.title}
      >
        <Button variant="ghost" size="sm" onClick={() => setEditingId("new")}>
          <Plus /> Card
        </Button>
        <Button
          size="sm"
          disabled={deck.dueCount + deck.newCount === 0}
          onClick={() => router.push(routes.study.review(notebookId, deckId))}
        >
          <Repeat /> Review
          <span className="tabular-nums opacity-80">
            {deck.dueCount + deck.newCount}
          </span>
        </Button>
        <RowActions>
          <DropdownMenuItem onSelect={() => setEditingDeck(true)}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => void removeDeck()}
          >
            Delete
          </DropdownMenuItem>
        </RowActions>
      </PageHeader>
      <PageToolbar>
        <SearchField value={query} onChange={setQuery} />
        <FilterTabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: cards.length },
            { value: "due", label: "Due", count: deck.dueCount },
            { value: "new", label: "New", count: deck.newCount },
            ...(staleCount > 0
              ? [{ value: "stale" as const, label: "Stale", count: staleCount }]
              : []),
            ...(suspendedCount > 0
              ? [
                  {
                    value: "suspended" as const,
                    label: "Suspended",
                    count: suspendedCount,
                  },
                ]
              : []),
          ]}
        />
        <ToolbarSpacer />
      </PageToolbar>
      <PageBody>
        <PageTitle
          title={deck.title}
          meta={
            <>
              <span className="tabular-nums">{deck.cardCount} cards</span>
              <span className="tabular-nums">{deck.dueCount} due</span>
              <span className="tabular-nums">{deck.newCount} new</span>
              {deck.description ? <span>{deck.description}</span> : null}
            </>
          }
        />
        <div className="flex flex-col">
          <div className="-mx-2 hidden grid-cols-[1fr_1fr_auto] gap-x-6 border-b px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground sm:grid">
            <span>Front</span>
            <span>Back</span>
            <span className="w-[10.5rem] text-right">Due</span>
          </div>
          {editingId === "new" ? (
            <div className="border-b border-border/70">
              <CardEditor
                submitLabel="Add"
                onSubmit={add}
                onCancel={() => setEditingId(null)}
              />
            </div>
          ) : null}
          {visible.length === 0 && editingId !== "new" ? (
            <EmptyState
              compact
              icon={<Layers3 />}
              label={cards.length === 0 ? "No cards" : "0 results"}
            />
          ) : (
            <ul className="flex flex-col">
              {visible.map((card) => (
                <CardRow
                  key={card._id}
                  card={card}
                  editing={editingId === card._id}
                  onEdit={() => setEditingId(card._id)}
                  onSave={(front, back) => save(card, front, back)}
                  onCancel={() => setEditingId(null)}
                  onToggleSuspend={() => void toggleSuspend(card)}
                  onDelete={() => void remove(card)}
                  onOpenSource={() => {
                    const source = card.sources[0];
                    if (source) void openStudySource(admin, source);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </PageBody>
      {editingDeck ? (
        <DeckDialog
          open
          onOpenChange={setEditingDeck}
          notebookId={notebookId}
          deck={deck}
          onSaved={(next) =>
            setDetail((current) =>
              current ? { ...current, deck: next } : current,
            )
          }
        />
      ) : null}
    </Page>
  );
}
