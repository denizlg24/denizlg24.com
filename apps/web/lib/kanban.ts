import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { getAppTimeZone, inTz } from "@/lib/timezone";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Course } from "@/models/Course";
import { type ILeanKanbanBoard, KanbanBoard } from "@/models/KanbanBoard";
import {
  type ILeanKanbanCard,
  KanbanCard,
  type KanbanPriority,
} from "@/models/KanbanCard";
import { type ILeanKanbanColumn, KanbanColumn } from "@/models/KanbanColumn";
import { Note } from "@/models/Note";
import { Person } from "@/models/Person";

export type CardEntityType = "calendar" | "note" | "person" | "course";

const CARD_ENTITY_FIELD_MAP = {
  calendar: "calendarEventIds",
  note: "noteIds",
  person: "personIds",
  course: "courseIds",
} as const;

function serializeCard<
  T extends {
    _id: unknown;
    boardId: unknown;
    columnId: unknown;
    hasDueTime?: boolean;
    calendarEventIds?: string[];
    noteIds?: string[];
    personIds?: string[];
    courseIds?: string[];
  },
>(card: T): ILeanKanbanCard {
  return {
    ...card,
    _id: String(card._id),
    boardId: String(card.boardId),
    columnId: String(card.columnId),
    hasDueTime: card.hasDueTime ?? false,
    calendarEventIds: card.calendarEventIds ?? [],
    noteIds: card.noteIds ?? [],
    personIds: card.personIds ?? [],
    courseIds: card.courseIds ?? [],
  } as unknown as ILeanKanbanCard;
}

export async function getAllBoards(): Promise<ILeanKanbanBoard[]> {
  await connectDB();
  const boards = await KanbanBoard.find({ isArchived: false })
    .sort({ createdAt: -1 })
    .lean();
  return boards.map((b) => ({ ...b, _id: b._id.toString() }));
}

export async function getFullBoard(boardId: string) {
  await connectDB();
  const board = await KanbanBoard.findById(boardId).lean();
  if (!board) return null;

  const columns = await KanbanColumn.find({ boardId })
    .sort({ order: 1 })
    .lean();
  const cards = await KanbanCard.find({ boardId, isArchived: false })
    .sort({ order: 1 })
    .lean();

  const cardsByColumn = cards.reduce(
    (acc, card) => {
      const colId = card.columnId.toString();
      if (!acc[colId]) acc[colId] = [];
      acc[colId].push(serializeCard(card));
      return acc;
    },
    {} as Record<string, ILeanKanbanCard[]>,
  );

  return {
    ...board,
    _id: board._id.toString(),
    columns: columns.map((col) => ({
      ...col,
      _id: col._id.toString(),
      boardId: col.boardId.toString(),
      cards: cardsByColumn[col._id.toString()] ?? [],
    })),
  };
}

export async function createBoard(data: {
  title: string;
  description?: string;
  color?: string;
}) {
  await connectDB();
  const board = await KanbanBoard.create(data);
  return { ...board.toObject(), _id: board._id.toString() };
}

export async function updateBoard(
  id: string,
  data: Partial<{
    title: string;
    description: string;
    color: string;
    isArchived: boolean;
  }>,
) {
  await connectDB();
  const board = await KanbanBoard.findByIdAndUpdate(id, data, {
    returnDocument: "after",
    runValidators: true,
  }).lean();
  if (!board) return null;
  return { ...board, _id: board._id.toString() };
}

export async function deleteBoard(id: string) {
  await connectDB();
  const board = await KanbanBoard.findByIdAndDelete(id);
  if (!board) return false;
  await KanbanColumn.deleteMany({ boardId: id });
  await KanbanCard.deleteMany({ boardId: id });
  return true;
}

export async function getBoardColumns(
  boardId: string,
): Promise<ILeanKanbanColumn[]> {
  await connectDB();
  const columns = await KanbanColumn.find({ boardId })
    .sort({ order: 1 })
    .lean();
  return columns.map((c) => ({
    ...c,
    _id: c._id.toString(),
    boardId: c.boardId.toString(),
  }));
}

export async function createColumn(
  boardId: string,
  data: {
    title: string;
    description?: string;
    color?: string;
    wipLimit?: number;
    icon?: string;
    isDoneColumn?: boolean;
    isCollapsed?: boolean;
    sortRule?: "manual" | "priority" | "dueDate";
  },
) {
  await connectDB();
  const lastCol = await KanbanColumn.findOne({ boardId })
    .sort({ order: -1 })
    .lean();
  const order = lastCol ? lastCol.order + 1 : 0;
  if (data.isDoneColumn) {
    await KanbanColumn.updateMany(
      { boardId },
      { $set: { isDoneColumn: false } },
    );
  }
  const column = await KanbanColumn.create({ boardId, order, ...data });
  return {
    ...column.toObject(),
    _id: column._id.toString(),
    boardId: column.boardId.toString(),
  };
}

export async function updateColumn(
  id: string,
  data: Partial<{
    title: string;
    description: string;
    color: string;
    wipLimit: number;
    icon: string;
    isDoneColumn: boolean;
    isCollapsed: boolean;
    sortRule: "manual" | "priority" | "dueDate";
  }>,
) {
  await connectDB();
  if (data.isDoneColumn) {
    const current = await KanbanColumn.findById(id).select("boardId").lean();
    if (!current) return null;
    await KanbanColumn.updateMany(
      { boardId: current.boardId, _id: { $ne: id } },
      { $set: { isDoneColumn: false } },
    );
  }
  const column = await KanbanColumn.findByIdAndUpdate(id, data, {
    returnDocument: "after",
    runValidators: true,
  }).lean();
  if (!column) return null;
  return {
    ...column,
    _id: column._id.toString(),
    boardId: column.boardId.toString(),
  };
}

export async function deleteColumn(id: string) {
  await connectDB();
  const column = await KanbanColumn.findByIdAndDelete(id);
  if (!column) return false;
  await KanbanCard.deleteMany({ columnId: id });
  return true;
}

export async function clearColumnCards(boardId: string, columnId: string) {
  await connectDB();
  const column = await KanbanColumn.findOne({ _id: columnId, boardId }).lean();
  if (!column) return null;
  const result = await KanbanCard.deleteMany({ boardId, columnId });
  return { deletedCount: result.deletedCount ?? 0 };
}

export async function reorderColumns(items: { _id: string; order: number }[]) {
  await connectDB();
  const bulkOps = items.map((item) => ({
    updateOne: {
      filter: { _id: new mongoose.Types.ObjectId(item._id) },
      update: { $set: { order: item.order } },
    },
  }));
  await KanbanColumn.bulkWrite(bulkOps);
  return true;
}

export async function getBoardCards(
  boardId: string,
  columnId?: string,
): Promise<ILeanKanbanCard[]> {
  await connectDB();
  const query: Record<string, unknown> = { boardId, isArchived: false };
  if (columnId) query.columnId = columnId;
  const cards = await KanbanCard.find(query)
    .sort({ columnId: 1, order: 1 })
    .lean();
  return cards.map((c) => serializeCard(c));
}

export async function getCardById(id: string) {
  await connectDB();
  const card = await KanbanCard.findById(id).lean();
  if (!card) return null;
  return serializeCard(card);
}

export async function createCard(
  boardId: string,
  columnId: string,
  data: {
    title: string;
    description?: string;
    labels?: string[];
    priority?: KanbanPriority;
    startDate?: string;
    dueDate?: string;
    hasDueTime?: boolean;
    calendarEventIds?: string[];
    noteIds?: string[];
    personIds?: string[];
    courseIds?: string[];
  },
) {
  await connectDB();
  const lastCard = await KanbanCard.findOne({ columnId })
    .sort({ order: -1 })
    .lean();
  const order = lastCard ? lastCard.order + 1 : 0;
  const card = await KanbanCard.create({ boardId, columnId, order, ...data });
  return serializeCard(card.toObject());
}

export async function updateCard(
  id: string,
  data: Partial<{
    columnId: string;
    title: string;
    description: string;
    order: number;
    labels: string[];
    priority: string;
    startDate: string | null;
    dueDate: string | null;
    hasDueTime: boolean;
    calendarEventIds: string[];
    noteIds: string[];
    personIds: string[];
    courseIds: string[];
    isArchived: boolean;
  }>,
) {
  await connectDB();
  const card = await KanbanCard.findByIdAndUpdate(id, data, {
    returnDocument: "after",
    runValidators: true,
  }).lean();
  if (!card) return null;
  return serializeCard(card);
}

export async function linkCardEntity(
  cardId: string,
  entityType: CardEntityType,
  entityId: string,
) {
  await connectDB();
  const field = CARD_ENTITY_FIELD_MAP[entityType];
  const card = await KanbanCard.findByIdAndUpdate(
    cardId,
    { $addToSet: { [field]: entityId } },
    { returnDocument: "after", runValidators: true },
  ).lean();
  return card ? serializeCard(card) : null;
}

export async function unlinkCardEntity(
  cardId: string,
  entityType: CardEntityType,
  entityId: string,
) {
  await connectDB();
  const field = CARD_ENTITY_FIELD_MAP[entityType];
  const card = await KanbanCard.findByIdAndUpdate(
    cardId,
    { $pull: { [field]: entityId } },
    { returnDocument: "after", runValidators: true },
  ).lean();
  return card ? serializeCard(card) : null;
}

export async function getCardLinks(cardId: string) {
  await connectDB();
  const card = await KanbanCard.findById(cardId)
    .select("calendarEventIds noteIds personIds courseIds")
    .lean();
  if (!card) return null;

  const [calendarEvents, notes, people, courses] = await Promise.all([
    CalendarEvent.find({ _id: { $in: card.calendarEventIds ?? [] } })
      .select("title date")
      .lean(),
    Note.find({ _id: { $in: card.noteIds ?? [] }, status: "open" })
      .select("title")
      .lean(),
    Person.find({ _id: { $in: card.personIds ?? [] } })
      .select("name")
      .lean(),
    Course.find({ _id: { $in: card.courseIds ?? [] }, status: "active" })
      .select("name")
      .lean(),
  ]);

  return {
    calendarEvents: calendarEvents.map((event) => ({
      _id: String(event._id),
      title: event.title,
      start: event.date.toISOString(),
    })),
    notes: notes.map((note) => ({
      _id: note._id.toString(),
      name: note.title,
    })),
    people: people.map((person) => ({
      _id: person._id.toString(),
      name: person.name,
    })),
    courses: courses.map((course) => ({
      _id: course._id.toString(),
      name: course.name,
    })),
  };
}

export async function deleteCard(id: string) {
  await connectDB();
  const card = await KanbanCard.findByIdAndDelete(id);
  return !!card;
}

export async function reorderCards(
  items: { _id: string; columnId: string; order: number }[],
) {
  await connectDB();
  const bulkOps = items.map((item) => ({
    updateOne: {
      filter: { _id: new mongoose.Types.ObjectId(item._id) },
      update: {
        $set: {
          columnId: new mongoose.Types.ObjectId(item.columnId),
          order: item.order,
        },
      },
    },
  }));
  await KanbanCard.bulkWrite(bulkOps);
  return true;
}

export interface UpcomingKanbanCard extends ILeanKanbanCard {
  columnTitle: string;
  daysUntilDue: number;
  overdue: boolean;
}

export interface UpcomingBoardGroup {
  boardId: string;
  boardTitle: string;
  boardColor?: string;
  cards: UpcomingKanbanCard[];
}

export interface UpcomingKanbanResult {
  boards: UpcomingBoardGroup[];
  stats: {
    total: number;
    overdue: number;
    dueToday: number;
    dueThisWeek: number;
  };
}

export async function getUpcomingCards(
  days = 7,
): Promise<UpcomingKanbanResult> {
  await connectDB();

  const timeZone = await getAppTimeZone();
  const now = inTz(new Date(), timeZone);
  const endOfToday = inTz(now, timeZone);
  endOfToday.setHours(23, 59, 59, 999);
  const horizon = inTz(now, timeZone);
  horizon.setDate(horizon.getDate() + days);
  horizon.setHours(23, 59, 59, 999);
  const endOfWeek = inTz(now, timeZone);
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  endOfWeek.setHours(23, 59, 59, 999);

  const cards = await KanbanCard.find({
    isArchived: false,
    dueDate: { $ne: null, $lte: horizon },
  })
    .sort({ dueDate: 1 })
    .lean();

  if (cards.length === 0) {
    return {
      boards: [],
      stats: { total: 0, overdue: 0, dueToday: 0, dueThisWeek: 0 },
    };
  }

  const boardIds = [...new Set(cards.map((c) => c.boardId.toString()))];
  const columnIds = [...new Set(cards.map((c) => c.columnId.toString()))];

  const [boards, columns] = await Promise.all([
    KanbanBoard.find({ _id: { $in: boardIds }, isArchived: false }).lean(),
    KanbanColumn.find({ _id: { $in: columnIds } }).lean(),
  ]);

  const boardById = new Map(boards.map((b) => [b._id.toString(), b] as const));
  const columnTitleById = new Map(
    columns.map((c) => [c._id.toString(), c.title] as const),
  );
  const doneColumnIds = new Set(
    columns
      .filter((column) => column.isDoneColumn)
      .map((column) => column._id.toString()),
  );

  const msPerDay = 24 * 60 * 60 * 1000;
  const grouped = new Map<string, UpcomingBoardGroup>();
  let overdue = 0;
  let dueToday = 0;
  let dueThisWeek = 0;

  for (const card of cards) {
    if (doneColumnIds.has(card.columnId.toString())) continue;
    const boardIdStr = card.boardId.toString();
    const board = boardById.get(boardIdStr);
    if (!board) continue;

    const due = card.dueDate as Date;
    const diffMs = due.getTime() - now.getTime();
    const daysUntilDue = Math.ceil(diffMs / msPerDay);
    const isOverdue = due < now;

    if (isOverdue) overdue++;
    else if (due <= endOfToday) dueToday++;
    if (due <= endOfWeek) dueThisWeek++;

    const upcomingCard: UpcomingKanbanCard = {
      ...serializeCard(card),
      columnTitle: columnTitleById.get(card.columnId.toString()) ?? "",
      daysUntilDue,
      overdue: isOverdue,
    };

    let group = grouped.get(boardIdStr);
    if (!group) {
      group = {
        boardId: boardIdStr,
        boardTitle: board.title,
        boardColor: board.color,
        cards: [],
      };
      grouped.set(boardIdStr, group);
    }
    group.cards.push(upcomingCard);
  }

  return {
    boards: [...grouped.values()],
    stats: {
      total: [...grouped.values()].reduce(
        (total, group) => total + group.cards.length,
        0,
      ),
      overdue,
      dueToday,
      dueThisWeek,
    },
  };
}
