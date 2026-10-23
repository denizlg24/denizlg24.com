import { z } from "zod";

export const macrosCacheVersionsSchema = z.object({
  foods: z.string().min(1).max(100),
  foodIcons: z.string().min(1).max(100),
});

export type MacrosCacheVersions = z.infer<typeof macrosCacheVersionsSchema>;

/**
 * Bump foods after catalogue or icon-assignment changes; bump foodIcons after
 * replacing artwork or its catalogue. Deploy the backend to publish a bump to
 * installed clients (0.1.0+), which check on launch, foreground and reconnect.
 * These are opaque revisions: a hash, date or incrementing string all work.
 */
export const MACROS_CACHE_VERSIONS = {
  foods: "foods-v1",
  foodIcons: "original-food-icons-v2",
} as const satisfies MacrosCacheVersions;
