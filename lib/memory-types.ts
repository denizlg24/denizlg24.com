import { z } from "zod";
import { symbolPattern } from "./universes";

export const memoryKinds = [
  "preference",
  "position",
  "thesis",
  "watch",
  "fact",
] as const;

export const memoryInputSchema = z.object({
  kind: z.enum(memoryKinds),
  content: z.string().trim().min(1).max(1000),
  symbols: z.array(z.string().regex(symbolPattern)).max(12).default([]),
});

export type MemoryKind = (typeof memoryKinds)[number];
export type MemoryInput = z.infer<typeof memoryInputSchema>;
export type Memory = MemoryInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type ThreadSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type Brief = {
  date: string;
  content: string;
  generatedAt: string;
};
