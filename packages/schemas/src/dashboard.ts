import { z } from "zod";

export const dashboardStatsSchema = z.object({
  contacts: z.object({
    total: z.number(),
    unread: z.number(),
    recent: z.array(
      z.object({
        _id: z.string(),
        name: z.string(),
        email: z.string(),
        createdAt: z.string(),
        status: z.string(),
      }),
    ),
  }),
  projects: z.object({
    total: z.number(),
    featured: z.number(),
  }),
  blogs: z.object({
    total: z.number(),
    published: z.number(),
  }),
  calendar: z.object({
    todayEvents: z.number(),
    upcomingEvents: z.number(),
    events: z.array(
      z.object({
        _id: z.string(),
        title: z.string(),
        date: z.string(),
        status: z.string(),
      }),
    ),
  }),
  comments: z.object({
    total: z.number(),
    pending: z.number(),
  }),
  timetable: z.array(
    z.object({
      _id: z.string(),
      title: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      place: z.string().optional(),
      color: z.string(),
    }),
  ),
  resources: z.array(
    z.object({
      _id: z.string(),
      name: z.string(),
      type: z.string(),
      status: z.enum(["healthy", "degraded", "unreachable"]).nullable(),
      lastCheckedAt: z.string().nullable(),
    }),
  ),
  emails: z.object({
    total: z.number(),
    unread: z.number(),
  }),
  triage: z.object({
    actionRequired: z.number(),
  }),
  notes: z.object({
    total: z.number(),
    recent: z.array(
      z.object({
        _id: z.string(),
        title: z.string(),
        updatedAt: z.string(),
      }),
    ),
  }),
  llm: z.object({
    todayCost: z.number(),
    todayRequests: z.number(),
    todayInputTokens: z.number(),
    todayOutputTokens: z.number(),
  }),
});
export type IDashboardStats = z.infer<typeof dashboardStatsSchema>;

export const dashboardAgendaItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["event", "class"]),
  title: z.string(),
  /** ISO instant; for an all-day event, the start of its day. */
  start: z.string(),
  end: z.string().nullable(),
  allDay: z.boolean(),
  place: z.string().optional(),
  courseId: z.string().optional(),
});
export type DashboardAgendaItem = z.infer<typeof dashboardAgendaItemSchema>;

export const dashboardBoardTodoSchema = z.object({
  elementId: z.string(),
  itemId: z.string(),
  text: z.string(),
  completed: z.boolean(),
});
export type DashboardBoardTodo = z.infer<typeof dashboardBoardTodoSchema>;

/**
 * `GET /dashboard/today`: exactly what the phone's Today tab and its widgets
 * draw, in one bounded request. Every section fails open to empty or null, so
 * one slow source never blanks the rest.
 */
export const dashboardTodaySchema = z.object({
  generatedAt: z.string(),
  /** `yyyy-MM-dd` in the app's time zone. */
  day: z.string(),
  timeZone: z.string(),
  agenda: z.array(dashboardAgendaItemSchema),
  counts: z.object({
    /** Triage rows with a suggestion still waiting on a decision. */
    triage: z.number(),
    actionNeeded: z.number(),
    unreadMail: z.number(),
    newContacts: z.number(),
    pendingComments: z.number(),
    budgetAlerts: z.number(),
  }),
  nextDeadline: z
    .object({
      courseId: z.string(),
      courseName: z.string(),
      title: z.string(),
      dueAt: z.string(),
      overdue: z.boolean(),
    })
    .nullable(),
  budget: z
    .object({
      currency: z.string(),
      plannedMinor: z.number(),
      spentMinor: z.number(),
      availableMinor: z.number(),
    })
    .nullable(),
  alerts: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      severity: z.enum(["info", "warning", "critical"]),
      title: z.string(),
      detail: z.string().optional(),
      firstSeenAt: z.string().optional(),
      envelopeId: z.string().optional(),
    }),
  ),
  resources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["healthy", "degraded", "unreachable"]).nullable(),
    }),
  ),
  board: z.object({
    whiteboardId: z.string().nullable(),
    todos: z.array(dashboardBoardTodoSchema),
  }),
  /** The now page's first line, as plain text. */
  now: z.string().nullable(),
  shift: z
    .object({
      jobName: z.string(),
      start: z.string(),
      onBreak: z.boolean(),
    })
    .nullable(),
  llm: z.object({ todayUsd: z.number(), monthUsd: z.number() }),
});
export type DashboardToday = z.infer<typeof dashboardTodaySchema>;

/** A quote as the phone hands it to the watchlist widget, which never fetches. */
export const dashboardWatchlistQuoteSchema = z.object({
  symbol: z.string(),
  price: z.number().nullable(),
  changePercent: z.number().nullable(),
  currency: z.string().nullable(),
});
export type DashboardWatchlistQuote = z.infer<
  typeof dashboardWatchlistQuoteSchema
>;
