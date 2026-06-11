import { z } from "zod";

export const blogUpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    excerpt: z.string().optional(),
    content: z.string().optional(),
    tags: z.array(z.string()).optional(),
    media: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
