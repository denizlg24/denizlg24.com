import {
  type DeckCreate,
  type DeckUpdate,
  type Deck as DeckWire,
  deckCreateSchema,
  deckUpdateSchema,
  type Flashcard as FlashcardWire,
} from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import { Deck, type ILeanDeck } from "@/models/Deck";
import { Flashcard, type ILeanFlashcard } from "@/models/Flashcard";
import { Notebook } from "@/models/Notebook";
import { ReviewLog } from "@/models/ReviewLog";
import { cardCountsBy } from "./counts";
import {
  NotebookNotFoundError,
  StudyNotFoundError,
  toObjectId,
} from "./errors";
import { deckToWire, flashcardToWire } from "./serialize";
import { loadChunkHashes } from "./source-refs";

const deckMissing = (id: string) => () => new StudyNotFoundError("deck", id);

export async function createDeck(input: DeckCreate): Promise<DeckWire> {
  const data = deckCreateSchema.parse(input);
  await connectDB();
  const notebookId = toObjectId(
    data.notebookId,
    () => new NotebookNotFoundError(data.notebookId),
  );
  if (!(await Notebook.exists({ _id: notebookId }))) {
    throw new NotebookNotFoundError(data.notebookId);
  }
  const created = await Deck.create({
    notebookId,
    title: data.title,
    ...(data.description ? { description: data.description } : {}),
  });
  return deckToWire(created.toObject());
}

export async function listDecks(notebookId: string): Promise<DeckWire[]> {
  await connectDB();
  const id = toObjectId(
    notebookId,
    () => new NotebookNotFoundError(notebookId),
  );
  const decks = await Deck.find({ notebookId: id })
    .sort({ createdAt: 1 })
    .lean<ILeanDeck[]>();
  const counts = await cardCountsBy(
    "deckId",
    decks.map((deck) => deck._id),
    new Date(),
  );
  return decks.map((deck) => deckToWire(deck, counts.get(String(deck._id))));
}

export async function getDeck(
  id: string,
): Promise<{ deck: DeckWire; cards: FlashcardWire[] }> {
  await connectDB();
  const deckId = toObjectId(id, deckMissing(id));
  const deck = await Deck.findById(deckId).lean<ILeanDeck>();
  if (!deck) throw new StudyNotFoundError("deck", id);
  const cards = await Flashcard.find({ deckId })
    .sort({ createdAt: 1 })
    .lean<ILeanFlashcard[]>();
  const [counts, hashes] = await Promise.all([
    cardCountsBy("deckId", [deck._id], new Date()),
    loadChunkHashes(cards),
  ]);
  return {
    deck: deckToWire(deck, counts.get(id)),
    cards: cards.map((card) => flashcardToWire(card, hashes)),
  };
}

export async function updateDeck(
  id: string,
  input: DeckUpdate,
): Promise<DeckWire> {
  const data = deckUpdateSchema.parse(input);
  await connectDB();
  const deckId = toObjectId(id, deckMissing(id));
  const update: {
    $set?: { title?: string; description?: string };
    $unset?: { description: "" };
  } = {};
  if (data.title !== undefined) update.$set = { title: data.title };
  if (data.description === null) update.$unset = { description: "" };
  else if (data.description !== undefined) {
    update.$set = { ...update.$set, description: data.description };
  }
  const deck = await Deck.findByIdAndUpdate(deckId, update, {
    new: true,
  }).lean<ILeanDeck>();
  if (!deck) throw new StudyNotFoundError("deck", id);
  const counts = await cardCountsBy("deckId", [deck._id], new Date());
  return deckToWire(deck, counts.get(id));
}

export async function deleteDeck(id: string): Promise<void> {
  await connectDB();
  const deckId = toObjectId(id, deckMissing(id));
  const deleted = await Deck.findByIdAndDelete(deckId);
  if (!deleted) throw new StudyNotFoundError("deck", id);
  await Promise.all([
    Flashcard.deleteMany({ deckId }),
    ReviewLog.deleteMany({ deckId }),
  ]);
}
