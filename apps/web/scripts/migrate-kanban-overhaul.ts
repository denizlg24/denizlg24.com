import { connectDB } from "@/lib/mongodb";
import { KanbanCard } from "@/models/KanbanCard";
import { KanbanColumn } from "@/models/KanbanColumn";

const DRY_RUN = process.argv.includes("--dry-run");
const NOTE_LINK_LINE = /^\[note\]\(([^,]+),([^\n)]+)\)$/gm;

async function main() {
  await connectDB();

  const cards = await KanbanCard.find({
    $or: [{ description: { $regex: /^\[note\]\(/m } }, { labels: "done" }],
  });
  const doneColumns = await KanbanColumn.find({
    title: { $regex: /^done$/i },
  }).sort({ boardId: 1, order: 1 });

  const firstDoneColumnByBoard = new Map<
    string,
    (typeof doneColumns)[number]
  >();
  for (const column of doneColumns) {
    const boardId = column.boardId.toString();
    if (!firstDoneColumnByBoard.has(boardId)) {
      firstDoneColumnByBoard.set(boardId, column);
    }
  }

  let noteLinks = 0;
  let doneLabels = 0;
  for (const card of cards) {
    const noteIds = new Set(card.noteIds ?? []);
    let description = card.description ?? "";
    description = description.replace(NOTE_LINK_LINE, (_line, id: string) => {
      noteIds.add(id.trim());
      noteLinks += 1;
      return "";
    });
    description = description.replace(/\n{3,}/g, "\n\n").trim();

    const labels = card.labels.filter((label) => label !== "done");
    if (labels.length !== card.labels.length) doneLabels += 1;

    if (!DRY_RUN) {
      card.noteIds = [...noteIds];
      card.labels = labels;
      card.description = description || undefined;
      await card.save();
    }
  }

  if (!DRY_RUN) {
    await KanbanColumn.updateMany(
      { isDoneColumn: true },
      { $set: { isDoneColumn: false } },
    );
    await KanbanColumn.updateMany(
      { _id: { $in: [...firstDoneColumnByBoard.values()].map((c) => c._id) } },
      { $set: { isDoneColumn: true } },
    );
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        cardsMatched: cards.length,
        noteLinksMigrated: noteLinks,
        doneLabelsRemoved: doneLabels,
        doneColumnsMarked: firstDoneColumnByBoard.size,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Kanban overhaul migration failed:", error);
    process.exit(1);
  });
