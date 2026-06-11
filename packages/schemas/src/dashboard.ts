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
