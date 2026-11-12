"use client";

import {
  REVIEW_RATINGS,
  type ReviewQueue,
  type ReviewRating,
} from "@repo/schemas";
import { MessageResponse } from "@repo/ui/ai-elements/message";
import { Button } from "@repo/ui/button";
import { Kbd } from "@repo/ui/kbd";
import { Page, PageHeader } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { formatInterval } from "@repo/utils/study";
import { Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { getReviewQueue, reviewCard } from "./study-api";
import { errorMessage, openStudySource, withParam } from "./study-format";

const QUEUE_LIMIT = 100;

const RATING_LABEL: Record<ReviewRating, string> = {
  again: "Again",
  hard: "Hard",
  good: "Good",
  easy: "Easy",
};

const RATING_TONE: Record<ReviewRating, string> = {
  again: "text-status-critical",
  hard: "text-status-warning",
  good: "text-status-good",
  easy: "text-status-info",
};

type QueueCard = ReviewQueue["cards"][number];

export function ReviewPage({
  notebookId,
  deckId,
}: {
  notebookId: string;
  deckId?: string;
}) {
  const admin = useAdmin();
  const { client, routes, slots } = admin;
  const router = useRouter();
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState({ due: 0, fresh: 0, total: 0 });
  const [rating, setRating] = useState<ReviewRating | null>(null);
  const shownAt = useRef(Date.now());

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await getReviewQueue(
          client,
          { notebookId, deckId, limit: QUEUE_LIMIT },
          { signal },
        );
        setQueue(next);
        setIndex(0);
        setRevealed(false);
        setReviewed((current) => ({ ...current, due: 0, fresh: 0 }));
        shownAt.current = Date.now();
      } catch (error) {
        if (signal?.aborted) return;
        toast.error(errorMessage(error, "Failed to load reviews"));
        setQueue((current) => current ?? { cards: [], due: 0, new: 0 });
      }
    },
    [client, deckId, notebookId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const card: QueueCard | undefined = queue?.cards[index];

  const rate = useCallback(
    async (choice: ReviewRating) => {
      if (!card || rating) return;
      setRating(choice);
      try {
        await reviewCard(client, card._id, {
          rating: choice,
          reviewedAt: new Date().toISOString(),
          durationMs: Math.min(3_600_000, Date.now() - shownAt.current),
        });
        const wasNew = card.fsrs.state === "new";
        setReviewed((current) => ({
          due: current.due + (wasNew ? 0 : 1),
          fresh: current.fresh + (wasNew ? 1 : 0),
          total: current.total + 1,
        }));
        if (queue && index + 1 >= queue.cards.length) {
          // Learning steps come due again within minutes; the server decides.
          await load();
        } else {
          setIndex((current) => current + 1);
          setRevealed(false);
          shownAt.current = Date.now();
        }
      } catch (error) {
        toast.error(errorMessage(error, "Failed to record review"));
      } finally {
        setRating(null);
      }
    },
    [card, client, index, load, queue, rating],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (!card) return;
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed) {
        const choice = REVIEW_RATINGS[Number(event.key) - 1];
        if (choice) {
          event.preventDefault();
          void rate(choice);
        } else if (event.key === " ") {
          event.preventDefault();
          void rate("good");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, rate, revealed]);

  const back = deckId
    ? routes.study.deck(notebookId, deckId)
    : withParam(routes.study.notebook(notebookId), "tab", "decks");

  const header = (
    <PageHeader
      leading={slots?.sidebarTrigger}
      crumbs={[
        { label: "Study", onClick: () => router.push(routes.study.index) },
        {
          label: deckId ? "Deck" : "Notebook",
          onClick: () => router.push(back),
        },
      ]}
      icon={<Repeat />}
      title="Review"
    >
      {queue ? (
        <span className="flex items-center gap-3 px-1 text-xs tabular-nums text-muted-foreground">
          <span>
            <span className="text-accent-strong">
              {Math.max(0, queue.due - reviewed.due)}
            </span>{" "}
            due
          </span>
          <span>
            <span className="text-accent-strong">
              {Math.max(0, queue.new - reviewed.fresh)}
            </span>{" "}
            new
          </span>
        </span>
      ) : null}
    </PageHeader>
  );

  if (!queue) {
    return (
      <Page>
        {header}
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Page>
    );
  }

  if (!card) {
    return (
      <Page>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <span className="font-calistoga text-5xl tabular-nums text-accent-strong">
            {reviewed.total}
          </span>
          <span className="text-xs text-muted-foreground">reviewed</span>
          <Button
            variant="ghost"
            size="sm"
            className="mt-4"
            onClick={() => router.push(back)}
          >
            Back
          </Button>
        </div>
      </Page>
    );
  }

  const now = new Date();
  const source = card.sources[0];

  return (
    <Page>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-6 py-12">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <span>{card.fsrs.state}</span>
            {card.stale ? (
              <span className="text-status-warning">stale</span>
            ) : null}
            <span className="ml-auto tabular-nums">
              {index + 1}/{queue.cards.length}
            </span>
          </div>
          <div className="pt-6 text-lg leading-relaxed text-accent-strong [&_.size-full]:text-lg">
            <MessageResponse>{card.front}</MessageResponse>
          </div>
          {revealed ? (
            <div className="mt-8 border-t pt-8 text-base">
              <MessageResponse>{card.back}</MessageResponse>
              {source ? (
                <button
                  type="button"
                  onClick={() => void openStudySource(admin, source)}
                  className="mt-4 text-xs text-muted-foreground underline-offset-2 hover:text-accent-strong hover:underline"
                >
                  Source
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex-1" />
        </div>
      </div>
      <div className="shrink-0 border-t">
        <div className="mx-auto flex w-full max-w-2xl items-stretch justify-center gap-2 px-6 py-3">
          {revealed ? (
            REVIEW_RATINGS.map((choice, at) => (
              <Button
                key={choice}
                variant="ghost"
                disabled={rating !== null}
                onClick={() => void rate(choice)}
                className={cn(
                  "h-auto flex-1 flex-col gap-0.5 py-2",
                  rating === choice && "bg-surface",
                )}
              >
                <span className={cn("text-sm", RATING_TONE[choice])}>
                  {RATING_LABEL[choice]}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
                  {formatInterval(now, new Date(card.preview[choice].due))}
                  <Kbd className="hidden sm:inline-flex">{at + 1}</Kbd>
                </span>
              </Button>
            ))
          ) : (
            <Button
              variant="outline"
              className="w-full max-w-xs"
              onClick={() => setRevealed(true)}
            >
              Show
              <Kbd className="hidden sm:inline-flex">Space</Kbd>
            </Button>
          )}
        </div>
      </div>
    </Page>
  );
}
