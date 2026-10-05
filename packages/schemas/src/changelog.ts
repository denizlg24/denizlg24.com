import { z } from "zod";

export const changelogInlineSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("strong"), text: z.string() }),
  z.object({ type: z.literal("code"), text: z.string() }),
  z.object({ type: z.literal("link"), text: z.string(), href: z.string() }),
]);

export const changelogBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("paragraph"),
    content: z.array(changelogInlineSchema),
  }),
  z.object({
    type: z.literal("list"),
    items: z.array(z.array(changelogInlineSchema)),
  }),
]);

export const changelogSectionSchema = z.object({
  /** The `###` heading; null for what sits directly under the release. */
  title: z.string().nullable(),
  blocks: z.array(changelogBlockSchema),
});

export const changelogReleaseSchema = z.object({
  version: z.string(),
  /** `YYYY-MM-DD`, or null for a release not yet dated. */
  date: z.string().nullable(),
  sections: z.array(changelogSectionSchema),
});

export const changelogResponseSchema = z.object({
  /** Newest first, in the order the file lists them. */
  releases: z.array(changelogReleaseSchema),
});

export type ChangelogInline = z.infer<typeof changelogInlineSchema>;
export type ChangelogBlock = z.infer<typeof changelogBlockSchema>;
export type ChangelogSection = z.infer<typeof changelogSectionSchema>;
export type ChangelogRelease = z.infer<typeof changelogReleaseSchema>;
export type ChangelogResponse = z.infer<typeof changelogResponseSchema>;
