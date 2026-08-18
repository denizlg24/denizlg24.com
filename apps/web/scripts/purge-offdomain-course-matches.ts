/**
 * Unpicks the course matches triage made from senders that are not allowed to
 * match a course.
 *
 * Course routing used to be offered on every action-needed or scheduled email,
 * and the deterministic matcher would fire on a four-letter triage context
 * value found anywhere in a body. Anything it hit got a `matchedCourseId`, and
 * auto-accept then wrote gradebook entries, course deadlines and calendar
 * events off the back of it. `courseSenderDomains` now gates the match; this
 * clears what the ungated rule already produced.
 *
 * Eligibility here is the sender domain alone. A row from an allowed domain
 * that was matched to the wrong course for some other reason is left alone —
 * deciding that needs the extraction model, not a script.
 *
 * What it removes for an ineligible row: the course link on the triage row, the
 * course assignments and calendar events its suggestions created, and the
 * course deadlines auto-accept mirrored from them (matched on course, title and
 * due date, which is the only handle those carry).
 *
 * What it keeps: kanban cards. A card is work in progress and may have been
 * moved, edited or picked up since; it is unlinked from the course rather than
 * deleted. Suggestions whose artifact was removed are marked dismissed — the
 * thing they created is gone, and nothing should ask about them again.
 *
 *   bun --env-file=../../.env scripts/purge-offdomain-course-matches.ts
 *     --execute      apply instead of reporting
 *     --verbose      print every affected row, not just the totals
 *     --limit=N      stop after N ineligible triage rows
 */
import mongoose from "mongoose";
import { deleteCalendarEvent } from "@/lib/calendar-events";
import { deleteCourseAssignment, deleteCourseDeadline } from "@/lib/courses";
import { connectDB } from "@/lib/mongodb";
import { isCourseEligibleSender } from "@/lib/triage";
import { Course } from "@/models/Course";
import { EmailModel } from "@/models/Email";
import { EmailTriageModel } from "@/models/EmailTriage";
import { KanbanCard } from "@/models/KanbanCard";
import {
  getOrCreateTriageSettings,
  normalizeCourseSenderDomains,
} from "@/models/TriageSettings";

const execute = process.argv.includes("--execute");
const verbose = process.argv.includes("--verbose");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg
  ? Number(limitArg.split("=")[1])
  : Number.POSITIVE_INFINITY;
if (limitArg && (!Number.isFinite(limit) || limit < 1)) {
  throw new Error(`Invalid --limit value: ${limitArg}`);
}

await connectDB();

const settings = await getOrCreateTriageSettings();
const allowedDomains = normalizeCourseSenderDomains(
  settings.toObject().courseSenderDomains,
);
if (allowedDomains.length === 0) {
  console.log(
    "courseSenderDomains is empty, so every sender is eligible and there is nothing to purge.",
  );
  await mongoose.disconnect();
  process.exit(0);
}

const matched = await EmailTriageModel.find({
  matchedCourseId: { $exists: true, $ne: null },
})
  .select(
    "emailId matchedCourseId matchedCourseName suggestedTasks suggestedEvents",
  )
  .lean();

const totals = {
  scanned: matched.length,
  eligible: 0,
  emailMissing: 0,
  ineligible: 0,
  assignmentsDeleted: 0,
  deadlinesDeleted: 0,
  eventsDeleted: 0,
  cardsUnlinked: 0,
  linksCleared: 0,
};

for (const triage of matched) {
  if (totals.ineligible >= limit) break;

  const email = await EmailModel.findById(triage.emailId)
    .select("from subject")
    .lean();
  if (!email) {
    // No sender to judge, and the row's course link points at coursework
    // nothing can trace back to a message. Left alone rather than guessed at.
    totals.emailMissing++;
    continue;
  }

  const from = (email.from ?? []).map((sender) => ({
    name: sender.name,
    address: sender.address ?? "",
  }));
  if (isCourseEligibleSender(from, allowedDomains)) {
    totals.eligible++;
    continue;
  }

  totals.ineligible++;
  const courseId = triage.matchedCourseId?.toString();
  const removed: string[] = [];

  for (const task of triage.suggestedTasks ?? []) {
    if (task.status !== "accepted") continue;
    const taskCourseId = task.courseId?.toString() ?? courseId;

    if (task.acceptedAssignmentId && taskCourseId) {
      removed.push(`assignment "${task.title}"`);
      totals.assignmentsDeleted++;
      if (execute) {
        await deleteCourseAssignment(
          taskCourseId,
          task.acceptedAssignmentId.toString(),
        );
      }
    }

    // Auto-accept mirrored a dated course task onto the course as a manual
    // deadline whenever the card did not land on the course's own board. Those
    // rows carry no reference back here, so they are matched on the pair that
    // created them.
    if (taskCourseId && task.dueDate) {
      const course = await Course.findById(taskCourseId)
        .select("manualDeadlines")
        .lean();
      const dueAt = new Date(task.dueDate).getTime();
      const deadline = course?.manualDeadlines?.find(
        (entry) =>
          entry.title === task.title &&
          new Date(entry.dueAt).getTime() === dueAt,
      );
      if (deadline) {
        removed.push(`deadline "${task.title}"`);
        totals.deadlinesDeleted++;
        if (execute) {
          await deleteCourseDeadline(taskCourseId, deadline._id.toString());
        }
      }
    }

    if (task.acceptedCardId && taskCourseId) {
      removed.push(`card "${task.title}" (kept, unlinked)`);
      totals.cardsUnlinked++;
      if (execute) {
        await KanbanCard.updateOne(
          { _id: task.acceptedCardId },
          { $pull: { courseIds: taskCourseId } },
        );
      }
    }
  }

  for (const event of triage.suggestedEvents ?? []) {
    if (event.status !== "accepted" || !event.acceptedEventId) continue;
    const eventCourseId = event.courseId?.toString() ?? courseId;
    removed.push(`event "${event.title}"`);
    totals.eventsDeleted++;
    if (execute) {
      await deleteCalendarEvent(event.acceptedEventId.toString());
      if (eventCourseId) {
        await Course.updateOne(
          { _id: eventCourseId },
          { $pull: { calendarEventIds: event.acceptedEventId } },
        );
      }
    }
  }

  totals.linksCleared++;
  if (verbose) {
    const sender = from[0]?.address ?? "unknown sender";
    console.log(
      `${execute ? "clearing" : "would clear"} ${triage._id} ` +
        `(${sender} → ${triage.matchedCourseName ?? courseId})` +
        (removed.length > 0 ? `: ${removed.join(", ")}` : ""),
    );
  }

  if (!execute) continue;

  await EmailTriageModel.updateOne(
    { _id: triage._id },
    {
      $unset: { matchedCourseId: 1, matchedCourseName: 1 },
      $set: {
        // Marked settled rather than reopened: what these produced has been
        // removed, and a pending suggestion would put the same noise back in
        // front of the owner.
        ...Object.fromEntries(
          (triage.suggestedTasks ?? []).flatMap((task, index) =>
            task.status === "accepted"
              ? [[`suggestedTasks.${index}.status`, "dismissed"]]
              : [],
          ),
        ),
        ...Object.fromEntries(
          (triage.suggestedEvents ?? []).flatMap((event, index) =>
            event.status === "accepted"
              ? [[`suggestedEvents.${index}.status`, "dismissed"]]
              : [],
          ),
        ),
      },
    },
  );
}

console.log(
  JSON.stringify(
    {
      mode: execute ? "execute" : "dry-run",
      allowedDomains,
      matchedRowsScanned: totals.scanned,
      eligible: totals.eligible,
      emailRowMissing: totals.emailMissing,
      ineligible: totals.ineligible,
      courseLinksCleared: totals.linksCleared,
      assignmentsDeleted: totals.assignmentsDeleted,
      courseDeadlinesDeleted: totals.deadlinesDeleted,
      calendarEventsDeleted: totals.eventsDeleted,
      kanbanCardsUnlinkedButKept: totals.cardsUnlinked,
    },
    null,
    2,
  ),
);

if (!execute) {
  console.log("\nDry run. Re-run with --execute to apply.");
}

await mongoose.disconnect();
