import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { type ILeanKanbanBoard, KanbanBoard } from "@/models/KanbanBoard";
import {
  type ILeanKanbanCard,
  KanbanCard,
  type KanbanPriority,
} from "@/models/KanbanCard";
import { type ILeanKanbanColumn, KanbanColumn } from "@/models/KanbanColumn";

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
      acc[colId].push({
        ...card,
        _id: card._id.toString(),
        boardId: card.boardId.toString(),
        columnId: colId,
      });
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
  data: { title: string; color?: string; wipLimit?: number; icon?: string },
) {
  await connectDB();
  const lastCol = await KanbanColumn.findOne({ boardId })
    .sort({ order: -1 })
    .lean();
  const order = lastCol ? lastCol.order + 1 : 0;
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
    color: string;
    wipLimit: number;
    icon: string;
  }>,
) {
  await connectDB();
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
  return cards.map((c) => ({
    ...c,
    _id: c._id.toString(),
    boardId: c.boardId.toString(),
    columnId: c.columnId.toString(),
  }));
}

export async function getCardById(id: string) {
  await connectDB();
  const card = await KanbanCard.findById(id).lean();
  if (!card) return null;
  return {
    ...card,
    _id: card._id.toString(),
    boardId: card.boardId.toString(),
    columnId: card.columnId.toString(),
  };
}

export async function createCard(
  boardId: string,
  columnId: string,
  data: {
    title: string;
    description?: string;
    labels?: string[];
    priority?: KanbanPriority;
    dueDate?: string;
  },
) {
  await connectDB();
  const lastCard = await KanbanCard.findOne({ columnId })
    .sort({ order: -1 })
    .lean();
  const order = lastCard ? lastCard.order + 1 : 0;
  const card = await KanbanCard.create({ boardId, columnId, order, ...data });
  return {
    ...card.toObject(),
    _id: card._id.toString(),
    boardId: card.boardId.toString(),
    columnId: card.columnId.toString(),
  };
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
    dueDate: string | null;
    isArchived: boolean;
  }>,
) {
  await connectDB();
  const card = await KanbanCard.findByIdAndUpdate(id, data, {
    returnDocument: "after",
    runValidators: true,
  }).lean();
  if (!card) return null;
  return {
    ...card,
    _id: card._id.toString(),
    boardId: card.boardId.toString(),
    columnId: card.columnId.toString(),
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

  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + days);
  horizon.setHours(23, 59, 59, 999);
  const endOfWeek = new Date(now);
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

  const msPerDay = 24 * 60 * 60 * 1000;
  const grouped = new Map<string, UpcomingBoardGroup>();
  let overdue = 0;
  let dueToday = 0;
  let dueThisWeek = 0;

  for (const card of cards) {
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
      ...card,
      _id: card._id.toString(),
      boardId: boardIdStr,
      columnId: card.columnId.toString(),
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
      total: cards.filter((c) => boardById.has(c.boardId.toString())).length,
      overdue,
      dueToday,
      dueThisWeek,
    },
  };
}
