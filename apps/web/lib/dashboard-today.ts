import { TZDate } from "@date-fns/tz";
import type {
  DashboardAgendaItem,
  DashboardBoardTodo,
  DashboardToday,
  IWhiteboardElement,
} from "@repo/schemas";
import { addDays, startOfDay, startOfMonth } from "date-fns";
import { getSemesterOverview } from "@/lib/courses";
import { getFinanceBudgetOverview } from "@/lib/finance/budget";
import {
  countOpenFinanceBudgetAlerts,
  listFinanceBudgetAlerts,
} from "@/lib/finance/budget-alerts";
import { connectDB } from "@/lib/mongodb";
import { getNowPageContent } from "@/lib/now-page";
import { dateKeyInTz, getAppTimeZone, inTz } from "@/lib/timezone";
import { getTodayBoard } from "@/lib/whiteboard";
import { BlogComment } from "@/models/BlogComment";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Contact } from "@/models/Contact";
import { EmailModel } from "@/models/Email";
import {
  EmailTriageModel,
  PENDING_SUGGESTION_FILTER,
} from "@/models/EmailTriage";
import { LlmUsage } from "@/models/LlmUsage";
import { Resource } from "@/models/Resource";
import { TimetableEntry } from "@/models/TimetableEntry";
import { WorkJob, WorkSession } from "@/models/WorkHours";

/** Bounded so a busy board cannot grow the widget payload without limit. */
const MAX_BOARD_TODOS = 60;
const MAX_ALERTS = 5;

interface AgendaEvent {
  _id: unknown;
  title: string;
  date: Date;
  endDate?: Date;
  isAllDay?: boolean;
  place?: string;
}

interface AgendaClass {
  _id: unknown;
  title: string;
  startTime: string;
  endTime: string;
  place?: string;
}

/** `HH:mm` on `day` in the app's zone, as an instant. */
function slotInstant(day: TZDate, time: string, timeZone: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  // TZDate's own toISOString keeps the zone's offset; the agenda compares
  // these as strings against UTC ones, so normalise through Date.
  const local = new TZDate(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes,
    timeZone,
  );
  return new Date(local.getTime()).toISOString();
}

/** Events and today's timetable slots as one list, all-day first, then by start. */
export function buildAgenda(
  events: AgendaEvent[],
  classes: AgendaClass[],
  day: TZDate,
  timeZone: string,
): DashboardAgendaItem[] {
  const items: DashboardAgendaItem[] = [
    ...events.map((event) => ({
      id: String(event._id),
      kind: "event" as const,
      title: event.title,
      start: event.date.toISOString(),
      end: event.endDate ? event.endDate.toISOString() : null,
      allDay: event.isAllDay === true,
      ...(event.place ? { place: event.place } : {}),
    })),
    ...classes.map((entry) => ({
      id: String(entry._id),
      kind: "class" as const,
      title: entry.title,
      start: slotInstant(day, entry.startTime, timeZone),
      end: slotInstant(day, entry.endTime, timeZone),
      allDay: false,
      ...(entry.place ? { place: entry.place } : {}),
    })),
  ];
  return items.sort(
    (a, b) =>
      Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start),
  );
}

/** Every todo-list row on the board, top to bottom as the board reads. */
export function boardTodos(
  elements: IWhiteboardElement[],
): DashboardBoardTodo[] {
  const lists = elements
    .filter(
      (element) =>
        element.type === "component" && element.componentType === "todo-list",
    )
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const todos: DashboardBoardTodo[] = [];
  for (const list of lists) {
    const items = Array.isArray(list.data.items) ? list.data.items : [];
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const id = "id" in item && typeof item.id === "string" ? item.id : null;
      if (!id) continue;
      todos.push({
        elementId: list.id,
        itemId: id,
        text: "text" in item && typeof item.text === "string" ? item.text : "",
        completed: "completed" in item && item.completed === true,
      });
      if (todos.length >= MAX_BOARD_TODOS) return todos;
    }
  }
  return todos;
}

/** The first line of the now page with its Markdown marks taken off. */
export function nowLine(content: string | undefined): string | null {
  const line = content
    ?.split("\n")
    .map((row) =>
      row
        .replace(/^\s*(#{1,6}|[-*+]|\d+\.|>)\s*/, "")
        .replace(/[*_`~]/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .trim(),
    )
    .find(Boolean);
  return line ?? null;
}

/** A source that fails gives its fallback, never a failed Today. */
async function settle<T>(label: string, work: () => Promise<T>, fallback: T) {
  try {
    return await work();
  } catch (error) {
    console.error(`[dashboard-today] ${label} failed`, error);
    return fallback;
  }
}

export async function getDashboardToday(
  now = new Date(),
): Promise<DashboardToday> {
  await connectDB();
  const timeZone = await getAppTimeZone();
  const local = inTz(now, timeZone);
  const dayStart = startOfDay(local);
  const dayEnd = addDays(dayStart, 1);
  const monthStart = startOfMonth(local);

  const [
    events,
    classes,
    counts,
    alertCount,
    alerts,
    overview,
    budget,
    resources,
    board,
    nowPage,
    shift,
    llm,
  ] = await Promise.all([
    settle(
      "calendar",
      () =>
        CalendarEvent.find({
          date: { $lt: dayEnd },
          $or: [{ date: { $gte: dayStart } }, { endDate: { $gte: dayStart } }],
          status: { $ne: "canceled" },
          "source.isSuppressed": { $ne: true },
        })
          .sort({ date: 1 })
          .limit(30)
          .select("title date endDate isAllDay place")
          .lean<AgendaEvent[]>(),
      [],
    ),
    settle(
      "timetable",
      () =>
        TimetableEntry.find({
          dayOfWeek: (local.getDay() + 6) % 7,
          isActive: true,
        })
          .sort({ startTime: 1 })
          .select("title startTime endTime place")
          .lean<AgendaClass[]>(),
      [],
    ),
    settle(
      "counts",
      async () => {
        const [triage, actionNeeded, unreadMail, newContacts, pendingComments] =
          await Promise.all([
            EmailTriageModel.countDocuments(PENDING_SUGGESTION_FILTER),
            EmailTriageModel.countDocuments({
              category: "action-needed",
              userStatus: "pending",
            }),
            EmailModel.countDocuments({ seen: false }),
            Contact.countDocuments({ status: "pending" }),
            BlogComment.countDocuments({
              isApproved: false,
              isDeleted: { $ne: true },
            }),
          ]);
        return {
          triage,
          actionNeeded,
          unreadMail,
          newContacts,
          pendingComments,
        };
      },
      {
        triage: 0,
        actionNeeded: 0,
        unreadMail: 0,
        newContacts: 0,
        pendingComments: 0,
      },
    ),
    settle("alert count", () => countOpenFinanceBudgetAlerts(), null),
    settle(
      "alerts",
      () => listFinanceBudgetAlerts({ status: ["open"], limit: MAX_ALERTS }),
      [],
    ),
    settle("courses", () => getSemesterOverview(), null),
    settle("budget", () => getFinanceBudgetOverview(now), null),
    settle(
      "resources",
      () =>
        Resource.find({ isActive: true })
          .select("name agentService.lastStatus")
          .lean<
            {
              _id: unknown;
              name: string;
              agentService?: {
                lastStatus?: "healthy" | "degraded" | "unreachable";
              };
            }[]
          >(),
      [],
    ),
    settle("board", () => getTodayBoard(), null),
    settle("now page", () => getNowPageContent(), null),
    settle(
      "shift",
      async () => {
        const open = await WorkSession.findOne({ openKey: "open" }).lean();
        if (!open) return null;
        const job = await WorkJob.findById(open.jobId).select("name").lean();
        return {
          jobName: job?.name ?? "Shift",
          start: open.start.toISOString(),
          onBreak: open.breaks.some((item) => !item.end),
        };
      },
      null,
    ),
    settle(
      "llm",
      async () => {
        const rows = await LlmUsage.aggregate<{
          _id: "today" | "earlier";
          cost: number;
        }>([
          { $match: { createdAt: { $gte: monthStart } } },
          {
            $group: {
              _id: {
                $cond: [{ $gte: ["$createdAt", dayStart] }, "today", "earlier"],
              },
              cost: { $sum: "$costUsd" },
            },
          },
        ]);
        const today = rows.find((row) => row._id === "today")?.cost ?? 0;
        const earlier = rows.find((row) => row._id === "earlier")?.cost ?? 0;
        return { todayUsd: today, monthUsd: today + earlier };
      },
      { todayUsd: 0, monthUsd: 0 },
    ),
  ]);

  const deadline = overview?.deadlines.find((item) => !item.completed) ?? null;

  return {
    generatedAt: now.toISOString(),
    day: dateKeyInTz(now, timeZone),
    timeZone,
    agenda: buildAgenda(events, classes, local, timeZone),
    counts: { ...counts, budgetAlerts: alertCount?.total ?? alerts.length },
    nextDeadline: deadline
      ? {
          courseId: deadline.courseId,
          courseName: deadline.courseName,
          title: deadline.title,
          dueAt: deadline.dueAt,
          overdue: deadline.overdue,
        }
      : null,
    budget: budget
      ? {
          currency: budget.totals.currency,
          plannedMinor: budget.totals.plannedMinor,
          spentMinor: budget.totals.spentMinor,
          availableMinor: budget.totals.availableMinor,
        }
      : null,
    alerts: alerts.slice(0, MAX_ALERTS).map((alert) => ({
      id: alert.id,
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
      ...(alert.envelopeId ? { envelopeId: alert.envelopeId } : {}),
    })),
    resources: resources.map((resource) => ({
      id: String(resource._id),
      name: resource.name,
      status: resource.agentService?.lastStatus ?? null,
    })),
    board: {
      whiteboardId: board ? String(board._id) : null,
      todos: board ? boardTodos(board.elements) : [],
    },
    now: nowLine(nowPage?.content),
    shift,
    llm,
  };
}
