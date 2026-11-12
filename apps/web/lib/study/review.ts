import {
  type Flashcard as FlashcardWire,
  type ReviewInput,
  type ReviewPreview,
  type ReviewQueue,
  reviewInputSchema,
} from "@repo/schemas";
import { previewReview, scheduleReview } from "@repo/utils/study";
import { startOfDay } from "date-fns";
import { connectDB } from "@/lib/mongodb";
import { getAppTimeZone, inTz } from "@/lib/timezone";
import { Flashcard, type ILeanFlashcard } from "@/models/Flashcard";
import { ReviewLog } from "@/models/ReviewLog";
import { StudyNotFoundError, toObjectId } from "./errors";
import {
  DEFAULT_NEW_PER_DAY,
  MAX_DUE_PER_QUEUE,
  newCardAllowance,
  planReviewQueue,
} from "./review-queue";
import { flashcardToWire, fsrsFromWire, fsrsToWire } from "./serialize";
import { loadChunkHashes } from "./source-refs";

export async function getReviewQueue(opts: {
  notebookId?: string;
  deckId?: string;
  limit?: number;
}): Promise<ReviewQueue> {
  await connectDB();
  const now = new Date();
  const limit = opts.limit ?? DEFAULT_NEW_PER_DAY;
  const scope: { notebookId?: string; deckId?: string } = {};
  if (opts.notebookId) {
    scope.notebookId = toObjectIdString(opts.notebookId, "notebook");
  }
  if (opts.deckId) scope.deckId = toObjectIdString(opts.deckId, "deck");

  const dayStart = startOfDay(inTz(now, await getAppTimeZone()));
  const [introducedToday, dueCards, dueTotal, newCards, newTotal] =
    await Promise.all([
      ReviewLog.countDocuments({
        ...scope,
        stateBefore: "new",
        reviewedAt: { $gte: new Date(dayStart.getTime()) },
      }),
      Flashcard.find({
        ...scope,
        suspended: false,
        "fsrs.state": { $ne: "new" },
        "fsrs.due": { $lte: now },
      })
        .sort({ "fsrs.due": 1 })
        .limit(MAX_DUE_PER_QUEUE)
        .lean<ILeanFlashcard[]>(),
      Flashcard.countDocuments({
        ...scope,
        suspended: false,
        "fsrs.state": { $ne: "new" },
        "fsrs.due": { $lte: now },
      }),
      Flashcard.find({ ...scope, suspended: false, "fsrs.state": "new" })
        .sort({ createdAt: 1 })
        .limit(limit)
        .lean<ILeanFlashcard[]>(),
      Flashcard.countDocuments({
        ...scope,
        suspended: false,
        "fsrs.state": "new",
      }),
    ]);

  const allowance = newCardAllowance(limit, introducedToday);
  const { due, fresh } = planReviewQueue(
    [...dueCards, ...newCards],
    now,
    allowance,
  );
  const ordered = [...due, ...fresh];
  const hashes = await loadChunkHashes(ordered);
  return {
    cards: ordered.map((card) => ({
      ...flashcardToWire(card, hashes),
      preview: previewReview(fsrsToWire(card.fsrs), now),
    })),
    due: dueTotal,
    new: Math.min(newTotal, allowance),
  };
}

function toObjectIdString(id: string, entity: string): string {
  return toObjectId(id, () => new StudyNotFoundError(entity, id)).toString();
}

export async function reviewCard(
  id: string,
  input: ReviewInput,
): Promise<{ card: FlashcardWire; preview: ReviewPreview }> {
  const data = reviewInputSchema.parse(input);
  await connectDB();
  const cardId = toObjectId(id, () => new StudyNotFoundError("card", id));
  const current = await Flashcard.findById(cardId).lean<ILeanFlashcard>();
  if (!current) throw new StudyNotFoundError("card", id);

  const reviewedAt = data.reviewedAt ? new Date(data.reviewedAt) : new Date();
  const before = fsrsToWire(current.fsrs);
  const after = scheduleReview(before, data.rating, reviewedAt);

  const updated = await Flashcard.findByIdAndUpdate(
    cardId,
    { $set: { fsrs: fsrsFromWire(after) } },
    { new: true },
  ).lean<ILeanFlashcard>();
  if (!updated) throw new StudyNotFoundError("card", id);

  await ReviewLog.create({
    cardId,
    deckId: current.deckId,
    notebookId: current.notebookId,
    rating: data.rating,
    stateBefore: before.state,
    due: new Date(after.due),
    scheduledDays: after.scheduledDays,
    ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
    reviewedAt,
  });

  const hashes = await loadChunkHashes([updated]);
  return {
    card: flashcardToWire(updated, hashes),
    preview: previewReview(after, reviewedAt),
  };
}
