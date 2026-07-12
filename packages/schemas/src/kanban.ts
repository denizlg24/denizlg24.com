import { z } from "zod";

export const kanbanBoardSchema = z.object({
  _id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  isArchived: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type IKanbanBoard = z.infer<typeof kanbanBoardSchema>;

export const kanbanPrioritySchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "urgent",
]);
export type KanbanPriority = z.infer<typeof kanbanPrioritySchema>;

export const kanbanCardLinkedEntityTypeSchema = z.enum([
  "calendar",
  "note",
  "person",
  "course",
]);
export type KanbanCardLinkedEntityType = z.infer<
  typeof kanbanCardLinkedEntityTypeSchema
>;

export const kanbanCardLinksSchema = z.object({
  calendarEvents: z.array(
    z.object({
      _id: z.string(),
      title: z.string(),
      start: z.string(),
    }),
  ),
  notes: z.array(z.object({ _id: z.string(), name: z.string() })),
  people: z.array(z.object({ _id: z.string(), name: z.string() })),
  courses: z.array(z.object({ _id: z.string(), name: z.string() })),
});
export type IKanbanCardLinks = z.infer<typeof kanbanCardLinksSchema>;

export const kanbanCardSchema = z.object({
  _id: z.string(),
  boardId: z.string(),
  columnId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  order: z.number(),
  labels: z.array(z.string()),
  priority: kanbanPrioritySchema,
  startDate: z.date().optional(),
  dueDate: z.date().optional(),
  hasDueTime: z.boolean().optional(),
  calendarEventIds: z.array(z.string()).default([]),
  noteIds: z.array(z.string()).default([]),
  personIds: z.array(z.string()).default([]),
  courseIds: z.array(z.string()).default([]),
  isArchived: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type IKanbanCard = z.infer<typeof kanbanCardSchema>;

export const kanbanColumnSchema = z.object({
  _id: z.string(),
  boardId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number(),
  wipLimit: z.number().optional(),
  isDoneColumn: z.boolean().optional(),
  isCollapsed: z.boolean().optional(),
  sortRule: z.enum(["manual", "priority", "dueDate"]).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type IKanbanColumn = z.infer<typeof kanbanColumnSchema>;

// Wire shape of GET /kanban/upcoming (dates are ISO strings over JSON).
// The fields beyond the base card are computed by the endpoint.
export const upcomingCardSchema = z.object({
  _id: z.string(),
  title: z.string(),
  dueDate: z.string().optional(),
  columnTitle: z.string(),
  daysUntilDue: z.number(),
  overdue: z.boolean(),
});
export type UpcomingCard = z.infer<typeof upcomingCardSchema>;

export const upcomingBoardGroupSchema = z.object({
  boardId: z.string(),
  boardTitle: z.string(),
  boardColor: z.string().optional(),
  cards: z.array(upcomingCardSchema),
});
export type UpcomingBoardGroup = z.infer<typeof upcomingBoardGroupSchema>;

export const upcomingKanbanResultSchema = z.object({
  boards: z.array(upcomingBoardGroupSchema),
  stats: z.object({
    total: z.number(),
    overdue: z.number(),
    dueToday: z.number(),
    dueThisWeek: z.number(),
  }),
});
export type UpcomingKanbanResult = z.infer<typeof upcomingKanbanResultSchema>;
