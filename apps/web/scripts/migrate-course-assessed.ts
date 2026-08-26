/**
 * Backfills `CourseAssignment.assessed` and retires the `other` type.
 *
 * Every row used to be a gradebook row. Triage set one `assignmentType` field
 * whose description conflated "coursework" with "assessment", so a required
 * reading or a registration deadline became a permanently ungraded gradebook
 * row that still moved the course average, the open-work count and the
 * semester headline.
 *
 * The rule below is the same one `coerceAssessed` in `lib/courses.ts` applies
 * on read, so a store that has not run this yet already behaves as if it had.
 * Running it makes the value explicit and lets the enum drop `other`:
 *
 *   assessed = true   when a score or a weight was recorded
 *   assessed = true   when type is exam or quiz
 *   assessed = false  when type is reading or other
 *   assessed = true   otherwise
 *
 * `other` rows are additionally retyped to `assignment`, because the enum no
 * longer accepts the value and mongoose would reject the next write to them.
 *
 * Dry run by default; `--execute` writes. The summary lists every row that
 * comes out unassessed so they can be eyeballed and promoted from the Work tab.
 */
import type mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { CourseAssignment } from "@/models/CourseAssignment";

const EXECUTE = process.argv.includes("--execute");
const DRY_RUN = process.argv.includes("--dry-run");

if (EXECUTE && DRY_RUN) {
  console.error("--dry-run and --execute are mutually exclusive.");
  process.exit(1);
}

interface RawAssignment {
  _id: mongoose.Types.ObjectId;
  courseId?: unknown;
  title?: unknown;
  type?: unknown;
  assessed?: unknown;
  grade?: { score?: unknown; weight?: unknown };
}

function isNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function decide(row: RawAssignment): boolean {
  if (isNumber(row.grade?.score) || isNumber(row.grade?.weight)) return true;
  const type = typeof row.type === "string" ? row.type : "";
  if (type === "exam" || type === "quiz") return true;
  if (type === "reading" || type === "other") return false;
  return true;
}

async function main() {
  await connectDB();

  const rows = await CourseAssignment.find({})
    .select("courseId title type assessed grade")
    .lean<RawAssignment[]>();

  const assessedUpdates: {
    id: mongoose.Types.ObjectId;
    assessed: boolean;
  }[] = [];
  const retypes: mongoose.Types.ObjectId[] = [];
  const unassessed: { title: string; type: string; courseId: string }[] = [];

  for (const row of rows) {
    const assessed = decide(row);
    if (row.assessed !== assessed) {
      assessedUpdates.push({ id: row._id, assessed });
    }
    if (row.type === "other") retypes.push(row._id);
    if (!assessed) {
      unassessed.push({
        title: typeof row.title === "string" ? row.title : "(untitled)",
        type: typeof row.type === "string" ? row.type : "assignment",
        courseId: String(row.courseId ?? ""),
      });
    }
  }

  const summary = {
    scanned: rows.length,
    assessedWrites: assessedUpdates.length,
    retypedFromOther: retypes.length,
    unassessed: unassessed.length,
    executed: EXECUTE,
  };

  if (!EXECUTE) {
    console.log(JSON.stringify({ ...summary, review: unassessed }));
    return;
  }

  const trueIds = assessedUpdates
    .filter((update) => update.assessed)
    .map((update) => update.id);
  const falseIds = assessedUpdates
    .filter((update) => !update.assessed)
    .map((update) => update.id);

  if (trueIds.length > 0) {
    await CourseAssignment.updateMany(
      { _id: { $in: trueIds } },
      { $set: { assessed: true } },
    );
  }
  if (falseIds.length > 0) {
    await CourseAssignment.updateMany(
      { _id: { $in: falseIds } },
      { $set: { assessed: false } },
    );
  }
  if (retypes.length > 0) {
    await CourseAssignment.updateMany(
      { _id: { $in: retypes } },
      { $set: { type: "assignment" } },
    );
  }

  console.log(JSON.stringify({ ...summary, review: unassessed }));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
