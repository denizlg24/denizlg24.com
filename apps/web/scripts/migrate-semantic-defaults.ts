import { connectDB } from "@/lib/mongodb";
import { Note } from "@/models/Note";
import { NoteEdge } from "@/models/NoteEdge";
import { NoteGroup } from "@/models/NoteGroup";

async function main() {
  await connectDB();

  const [notes, manualGroups, generatedGroups, edges] = await Promise.all([
    Note.updateMany(
      { semanticStatus: { $exists: false } },
      { $set: { semanticStatus: "pending" } },
    ).exec(),
    NoteGroup.updateMany(
      {
        autoCreated: { $ne: true },
        $or: [
          { kind: { $exists: false } },
          { source: { $exists: false } },
          { lockedByUser: { $exists: false } },
        ],
      },
      {
        $set: {
          kind: "manual",
          source: "user",
          lockedByUser: true,
        },
        $setOnInsert: { aliases: [] },
      },
    ).exec(),
    NoteGroup.updateMany(
      {
        autoCreated: true,
        $or: [
          { kind: { $exists: false } },
          { source: { $exists: false } },
          { lockedByUser: { $exists: false } },
        ],
      },
      {
        $set: {
          kind: "generated",
          source: "llm",
          lockedByUser: false,
        },
        $setOnInsert: { aliases: [] },
      },
    ).exec(),
    NoteEdge.updateMany(
      { source: { $exists: false } },
      { $set: { source: "llm" } },
    ).exec(),
  ]);

  console.log(
    JSON.stringify(
      {
        notes: notes.modifiedCount,
        manualGroups: manualGroups.modifiedCount,
        generatedGroups: generatedGroups.modifiedCount,
        edges: edges.modifiedCount,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
