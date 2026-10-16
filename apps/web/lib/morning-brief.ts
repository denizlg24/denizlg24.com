import type { DashboardToday } from "@repo/schemas";
import { getDashboardToday } from "@/lib/dashboard-today";
import { scheduleDashboardPush } from "@/lib/mobile-push";
import { connectDB } from "@/lib/mongodb";
import { AgentMemoryCandidate } from "@/models/AgentMemoryCandidate";
import { AppSettings } from "@/models/AppSettings";

function clockIn(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/** `yyyy-MM-dd` of an instant in the app's zone. */
function dayIn(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/**
 * The brief as one line: how much is on, where the day starts, what is due
 * and what is left on the board. Counts and times, nothing more.
 */
export function briefLine(today: DashboardToday): string {
  const parts: string[] = [];
  const timed = today.agenda.filter((item) => !item.allDay);
  if (today.agenda.length === 0) {
    parts.push("Nothing on");
  } else {
    const first = timed[0];
    parts.push(
      `${today.agenda.length} on${first ? ` · first ${clockIn(first.start, today.timeZone)} ${first.title}` : ""}`,
    );
  }
  if (
    today.nextDeadline &&
    dayIn(today.nextDeadline.dueAt, today.timeZone) <= today.day
  ) {
    parts.push(`due: ${today.nextDeadline.title}`);
  }
  const open = today.board.todos.filter((todo) => !todo.completed).length;
  if (open > 0) parts.push(`${open} on the board`);
  return parts.join(" · ");
}

/**
 * Sent once per day however often the external scheduler calls: the day is
 * claimed on the settings row before anything goes out.
 */
export async function sendMorningBrief(now = new Date()) {
  await connectDB();
  const today = await getDashboardToday(now);
  try {
    const claimed = await AppSettings.updateOne(
      { _id: "singleton", morningBriefSentOn: { $ne: today.day } },
      { $set: { morningBriefSentOn: today.day } },
      { upsert: true },
    );
    if (claimed.modifiedCount === 0 && claimed.upsertedCount === 0) {
      return { sent: false, day: today.day };
    }
  } catch (error) {
    // The row exists and already holds today: the upsert collided with it.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      return { sent: false, day: today.day };
    }
    throw error;
  }

  scheduleDashboardPush({
    kind: "morning_brief",
    title: "Today",
    body: briefLine(today),
    subject: today.day,
    url: "dashboard://today",
  });
  const pending = await AgentMemoryCandidate.countDocuments({
    status: "pending",
  });
  if (pending > 0) {
    scheduleDashboardPush({
      kind: "memory_review",
      title: `${pending} ${pending === 1 ? "memory" : "memories"} to review`,
      subject: today.day,
      url: "dashboard://more/memory",
    });
  }
  return { sent: true, day: today.day };
}
