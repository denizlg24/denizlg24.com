import { z } from "zod";

export const whiteboardElementSchema = z.object({
  id: z.string(),
  type: z.enum(["drawing", "component"]),
  componentType: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  data: z.record(z.string(), z.unknown()),
  zIndex: z.number(),
});
export type IWhiteboardElement = z.infer<typeof whiteboardElementSchema>;

export const whiteboardSchema = z.object({
  _id: z.string(),
  name: z.string(),
  elements: z.array(whiteboardElementSchema),
  viewState: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IWhiteboard = z.infer<typeof whiteboardSchema>;

export const whiteboardMetaSchema = z.object({
  _id: z.string(),
  name: z.string(),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IWhiteboardMeta = z.infer<typeof whiteboardMetaSchema>;
