import type {
  FsrsCardState,
  FsrsState,
  ReviewPreview,
  ReviewRating,
} from "@repo/schemas";
import {
  type Card,
  createEmptyCard,
  fsrs,
  type Grade,
  Rating,
  State,
} from "ts-fsrs";

/** FSRS scheduling over `ts-fsrs`; shared so desktop previews what the server books. */

// Fuzz is off so the interval a button previews is the one that gets booked.
const scheduler = fsrs({ enable_fuzz: false });

const DAY_MS = 86_400_000;

const GRADES: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const STATE_TO_FSRS: Record<FsrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const STATE_FROM_FSRS: Record<State, FsrsState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

function toCard(state: FsrsCardState): Card {
  return {
    due: new Date(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: STATE_TO_FSRS[state.state],
    last_review: state.lastReview ? new Date(state.lastReview) : undefined,
  };
}

function fromCard(card: Card, elapsedDays: number): FsrsCardState {
  const state: FsrsCardState = {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_FROM_FSRS[card.state],
  };
  if (card.last_review) state.lastReview = card.last_review.toISOString();
  return state;
}

function elapsedSince(state: FsrsCardState, now: Date): number {
  if (!state.lastReview) return 0;
  return Math.max(
    0,
    Math.floor((now.getTime() - new Date(state.lastReview).getTime()) / DAY_MS),
  );
}

export function newCardState(now: Date = new Date()): FsrsCardState {
  return fromCard(createEmptyCard(now), 0);
}

export function scheduleReview(
  state: FsrsCardState,
  rating: ReviewRating,
  now: Date = new Date(),
): FsrsCardState {
  const { card } = scheduler.next(toCard(state), now, GRADES[rating]);
  return fromCard(card, elapsedSince(state, now));
}

export function previewReview(
  state: FsrsCardState,
  now: Date = new Date(),
): ReviewPreview {
  const log = scheduler.repeat(toCard(state), now);
  const entry = (rating: ReviewRating) => {
    const card = log[GRADES[rating]].card;
    return { due: card.due.toISOString(), scheduledDays: card.scheduled_days };
  };
  return {
    again: entry("again"),
    hard: entry("hard"),
    good: entry("good"),
    easy: entry("easy"),
  };
}

export function isDue(state: FsrsCardState, now: Date = new Date()): boolean {
  return new Date(state.due).getTime() <= now.getTime();
}

/** "10m", "5h", "3d", "4mo", "1.2y" — the label under a rating button. */
export function formatInterval(from: Date, to: Date): string {
  const ms = Math.max(0, to.getTime() - from.getTime());
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
