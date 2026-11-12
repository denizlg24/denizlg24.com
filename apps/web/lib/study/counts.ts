import type mongoose from "mongoose";
import { Flashcard } from "@/models/Flashcard";

export interface CardCounts {
  total: number;
  due: number;
  new: number;
}

/** Due means seen before and past its date; suspended cards count nowhere but the total. */
export async function cardCountsBy(
  field: "deckId" | "notebookId",
  ids: readonly mongoose.Types.ObjectId[],
  now: Date,
): Promise<Map<string, CardCounts>> {
  if (ids.length === 0) return new Map();
  const rows = await Flashcard.aggregate<{
    _id: mongoose.Types.ObjectId;
    total: number;
    due: number;
    new: number;
  }>([
    { $match: { [field]: { $in: ids } } },
    {
      $group: {
        _id: `$${field}`,
        total: { $sum: 1 },
        due: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$suspended", false] },
                  { $ne: ["$fsrs.state", "new"] },
                  { $lte: ["$fsrs.due", now] },
                ],
              },
              1,
              0,
            ],
          },
        },
        new: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$suspended", false] },
                  { $eq: ["$fsrs.state", "new"] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  return new Map(
    rows.map((row) => [
      String(row._id),
      { total: row.total, due: row.due, new: row.new },
    ]),
  );
}
