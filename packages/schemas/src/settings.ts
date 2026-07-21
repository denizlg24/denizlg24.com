import { z } from "zod";

export const appSettingsSchema = z.object({
  timeZone: z.string().nullable(),
  effectiveTimeZone: z.string(),
});
export type IAppSettings = z.infer<typeof appSettingsSchema>;

export const appSettingsResponseSchema = z.object({
  settings: appSettingsSchema,
});
export type AppSettingsResponse = z.infer<typeof appSettingsResponseSchema>;

const latexProjectPathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      path.split("/").every((part) => part && part !== "." && part !== ".."),
    "Invalid project path",
  );

export const latexFileEntrySchema = z.object({
  id: z.uuid(),
  path: latexProjectPathSchema,
  kind: z.literal("file"),
  encoding: z.enum(["utf8", "base64"]),
  content: z.string().max(2_800_000),
});
export type ILatexFileEntry = z.infer<typeof latexFileEntrySchema>;

export const latexFolderEntrySchema = z.object({
  id: z.uuid(),
  path: latexProjectPathSchema,
  kind: z.literal("folder"),
});
export type ILatexFolderEntry = z.infer<typeof latexFolderEntrySchema>;

export const latexProjectSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(100),
    mainFile: latexProjectPathSchema,
    entries: z
      .array(
        z.discriminatedUnion("kind", [
          latexFileEntrySchema,
          latexFolderEntrySchema,
        ]),
      )
      .min(1)
      .max(64),
  })
  .superRefine((project, context) => {
    const ids = new Set<string>();
    const paths = new Set<string>();
    let totalBytes = 0;
    for (const entry of project.entries) {
      if (ids.has(entry.id)) {
        context.addIssue({
          code: "custom",
          message: "Entry ids must be unique",
        });
      }
      if (paths.has(entry.path)) {
        context.addIssue({
          code: "custom",
          message: "Entry paths must be unique",
        });
      }
      ids.add(entry.id);
      paths.add(entry.path);
      if (entry.kind === "file") {
        totalBytes += new TextEncoder().encode(entry.content).byteLength;
        if (
          entry.encoding === "base64" &&
          (entry.content.length % 4 !== 0 ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
              entry.content,
            ))
        ) {
          context.addIssue({
            code: "custom",
            message: "Invalid base64 file content",
          });
        }
      }
    }
    if (totalBytes > 4 * 1024 * 1024) {
      context.addIssue({ code: "custom", message: "Project exceeds 4MB" });
    }
    const mainFile = project.entries.find(
      (entry) => entry.path === project.mainFile,
    );
    if (
      mainFile?.kind !== "file" ||
      mainFile.encoding !== "utf8" ||
      !mainFile.path.toLowerCase().endsWith(".tex")
    ) {
      context.addIssue({
        code: "custom",
        message: "Main file must be a UTF-8 .tex file",
      });
    }
  });
export type ILatexProject = z.infer<typeof latexProjectSchema>;

export const cvFileSchema = z.object({
  url: z.string(),
  filename: z.string(),
  size: z.number(),
  updatedAt: z.string(),
});
export type ICvFile = z.infer<typeof cvFileSchema>;

export const cvResponseSchema = z.object({
  cv: cvFileSchema.nullable(),
  draft: cvFileSchema.nullable(),
  project: latexProjectSchema.nullable(),
});
export type CvResponse = z.infer<typeof cvResponseSchema>;
