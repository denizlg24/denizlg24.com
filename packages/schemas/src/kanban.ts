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

export const kanbanCardSchema = z.object({
  _id: z.string(),
  boardId: z.string(),
  columnId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  order: z.number(),
  labels: z.array(z.string()),
  priority: kanbanPrioritySchema,
  dueDate: z.date().optional(),
  isArchived: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type IKanbanCard = z.infer<typeof kanbanCardSchema>;

export const kanbanColumnSchema = z.object({
  _id: z.string(),
  boardId: z.string(),
  title: z.string(),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number(),
  wipLimit: z.number().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type IKanbanColumn = z.infer<typeof kanbanColumnSchema>;
