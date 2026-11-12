import {
  type FlashcardsCreate,
  type FlashcardUpdate,
  type Flashcard as FlashcardWire,
  flashcardsCreateSchema,
  flashcardUpdateSchema,
} from "@repo/schemas";
import { newCardState } from "@repo/utils/study";
import { connectDB } from "@/lib/mongodb";
import { Deck } from "@/models/Deck";
import { Flashcard, type ILeanFlashcard } from "@/models/Flashcard";
import { ReviewLog } from "@/models/ReviewLog";
import { StudyNotFoundError, toObjectId } from "./errors";
import { flashcardToWire, fsrsFromWire } from "./serialize";
import { buildSourceRefs, loadChunkHashes } from "./source-refs";

const cardMissing = (id: string) => () => new StudyNotFoundError("card", id);

export async function createFlashcards(
  input: FlashcardsCreate,
): Promise<FlashcardWire[]> {
  const data = flashcardsCreateSchema.parse(input);
  await connectDB();
  const deckId = toObjectId(
    data.deckId,
    () => new StudyNotFoundError("deck", data.deckId),
  );
  const deck = await Deck.findById(deckId).select({ notebookId: 1 }).lean();
  if (!deck) throw new StudyNotFoundError("deck", data.deckId);

  const now = new Date();
  const docs = await Promise.all(
    data.cards.map(async (card) => ({
      deckId,
      notebookId: deck.notebookId,
      front: card.front,
      back: card.back,
      sources: await buildSourceRefs(card.sourceChunkIds),
      suspended: false,
      fsrs: fsrsFromWire(newCardState(now)),
    })),
  );
  const created = await Flashcard.insertMany(docs);
  const cards = created.map((doc) => doc.toObject() as ILeanFlashcard);
  const hashes = await loadChunkHashes(cards);
  return cards.map((card) => flashcardToWire(card, hashes));
}

export async function getFlashcard(id: string): Promise<FlashcardWire> {
  await connectDB();
  const card = await Flashcard.findById(
    toObjectId(id, cardMissing(id)),
  ).lean<ILeanFlashcard>();
  if (!card) throw new StudyNotFoundError("card", id);
  return flashcardToWire(card, await loadChunkHashes([card]));
}

export async function updateFlashcard(
  id: string,
  input: FlashcardUpdate,
): Promise<FlashcardWire> {
  const data = flashcardUpdateSchema.parse(input);
  await connectDB();
  const cardId = toObjectId(id, cardMissing(id));
  const set: Record<string, unknown> = {};
  if (data.front !== undefined) set.front = data.front;
  if (data.back !== undefined) set.back = data.back;
  if (data.suspended !== undefined) set.suspended = data.suspended;
  if (data.deckId !== undefined) {
    const target = await Deck.findById(data.deckId)
      .select({ notebookId: 1 })
      .lean();
    if (!target) throw new StudyNotFoundError("deck", data.deckId);
    const current = await Flashcard.findById(cardId)
      .select({ notebookId: 1 })
      .lean();
    if (!current) throw new StudyNotFoundError("card", id);
    if (String(current.notebookId) !== String(target.notebookId)) {
      throw new StudyNotFoundError("deck", data.deckId);
    }
    set.deckId = target._id;
  }
  const card = await Flashcard.findByIdAndUpdate(
    cardId,
    { $set: set },
    { new: true },
  ).lean<ILeanFlashcard>();
  if (!card) throw new StudyNotFoundError("card", id);
  return flashcardToWire(card, await loadChunkHashes([card]));
}

export async function deleteFlashcard(id: string): Promise<void> {
  await connectDB();
  const cardId = toObjectId(id, cardMissing(id));
  const deleted = await Flashcard.findByIdAndDelete(cardId);
  if (!deleted) throw new StudyNotFoundError("card", id);
  await ReviewLog.deleteMany({ cardId });
}
