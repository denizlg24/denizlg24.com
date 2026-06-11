import { connectDB } from "@/lib/mongodb";
import { KnowledgeSemanticSuggestion } from "@/models/KnowledgeSemanticSuggestion";
import { Note } from "@/models/Note";
import { NoteEdge } from "@/models/NoteEdge";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  await connectDB();

  const [edgeCount, notesCount, pendingEdgeSuggestions] = await Promise.all([
    NoteEdge.countDocuments(),
    Note.countDocuments(),
    KnowledgeSemanticSuggestion.countDocuments({
      status: "pending",
      type: { $in: ["add-edge", "archive-edge"] },
    }),
  ]);

  const summary = {
    dryRun: DRY_RUN,
    edgeCountBefore: edgeCount,
    notesToMarkStale: notesCount,
    pendingEdgeSuggestionsToSupersede: pendingEdgeSuggestions,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (DRY_RUN) {
    console.log("Dry run complete. No changes applied.");
    return;
  }

  const now = new Date();
  const [deletedEdges, staleNotes, supersededSuggestions] = await Promise.all([
    NoteEdge.deleteMany({}).exec(),
    Note.updateMany({}, { $set: { semanticStatus: "stale" } }).exec(),
    KnowledgeSemanticSuggestion.updateMany(
      {
        status: "pending",
        type: { $in: ["add-edge", "archive-edge"] },
      },
      { $set: { status: "superseded", decidedAt: now } },
    ).exec(),
  ]);

  const edgeCountAfter = await NoteEdge.countDocuments();

  console.log(
    JSON.stringify(
      {
        deletedEdges: deletedEdges.deletedCount,
        markedNotesStale: staleNotes.modifiedCount,
        supersededSuggestions: supersededSuggestions.modifiedCount,
        edgeCountAfter,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Remove note edges migration failed:", error);
    process.exit(1);
  });
