import { z } from "zod";
import { iconValueSchema } from "./workspace-appearance";

/**
 * Surfaces: whole-window apps the owner or an agent writes, each mounted in
 * place of the default shell's Home, in place of a module, or reachable on
 * its own route. A surface is HTML, CSS and JS run in a sandboxed iframe
 * (scripts, no same-origin) with an open network policy, so it may load any
 * library, font or image. Data and actions reach it only through the
 * `window.deniz` bridge, which forwards to the denizlg24 MCP server — the
 * same tool and catalog names an agent uses.
 *
 * `{{asset:<name>}}` anywhere in head/html/css/js is replaced by that
 * asset's URL at render.
 */

export const SURFACE_CODE_MAX = 512_000;
export const SURFACE_HEAD_MAX = 64_000;
export const SURFACE_STATE_MAX_BYTES = 256_000;
export const SURFACE_ASSETS_MAX = 100;
export const SURFACE_ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const SURFACE_ERRORS_MAX = 20;

export const surfaceIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/)
  .describe("Surface id");

export const surfaceAssetNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  .describe("Asset name, referenced as {{asset:<name>}} or deniz.asset(name)");

const moduleIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/)
  .describe("Module id from the workspace module registry, e.g. notes");

/**
 * Where a surface replaces the default UI. At most one surface holds each
 * `home` / module mount: mounting one unmounts whichever held it.
 */
export const surfaceMountSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("home") }),
  z.object({ kind: z.literal("module"), module: moduleIdSchema }),
]);
export type SurfaceMount = z.infer<typeof surfaceMountSchema>;

/** `sidebar` keeps the workspace sidebar beside the surface; `none` is the whole window. */
export const surfaceChromeSchema = z.enum(["sidebar", "none"]);
export type SurfaceChrome = z.infer<typeof surfaceChromeSchema>;

export const surfaceAssetSchema = z.object({
  name: surfaceAssetNameSchema,
  url: z.url(),
  contentType: z.string().max(200),
  size: z.number().int().nonnegative(),
});
export type SurfaceAsset = z.infer<typeof surfaceAssetSchema>;

export const surfaceErrorSchema = z.object({
  message: z.string().max(2000),
  source: z.string().max(500).optional(),
  at: z.string(),
});
export type SurfaceError = z.infer<typeof surfaceErrorSchema>;

export const surfaceStateSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (state) =>
      new TextEncoder().encode(JSON.stringify(state)).byteLength <=
      SURFACE_STATE_MAX_BYTES,
    `State must serialize to at most ${SURFACE_STATE_MAX_BYTES} bytes`,
  )
  .describe("Free-form JSON the surface persists through deniz.state");
export type SurfaceState = z.infer<typeof surfaceStateSchema>;

/** The versioned part of a surface: every change to these writes a revision. */
const surfaceCodeShape = {
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  icon: iconValueSchema.nullable().default(null),
  head: z
    .string()
    .max(SURFACE_HEAD_MAX)
    .default("")
    .describe(
      "Extra <head> markup: <script src>, <link rel=stylesheet>, fonts, meta",
    ),
  html: z.string().max(SURFACE_CODE_MAX).default("").describe("Body markup"),
  css: z.string().max(SURFACE_CODE_MAX).default(""),
  js: z
    .string()
    .max(SURFACE_CODE_MAX)
    .default("")
    .describe("Runs at the end of <body>; window.deniz is ready"),
  chrome: surfaceChromeSchema.default("none"),
};

export const surfaceInputSchema = z.object({
  ...surfaceCodeShape,
  mount: surfaceMountSchema.default({ kind: "none" }),
});
export type SurfaceInput = z.input<typeof surfaceInputSchema>;

export const surfacePatchSchema = z
  .object({
    name: surfaceCodeShape.name,
    description: z.string().max(2000),
    icon: iconValueSchema.nullable(),
    head: z.string().max(SURFACE_HEAD_MAX),
    html: z.string().max(SURFACE_CODE_MAX),
    css: z.string().max(SURFACE_CODE_MAX),
    js: z.string().max(SURFACE_CODE_MAX),
    chrome: surfaceChromeSchema,
    mount: surfaceMountSchema,
    baseRev: z
      .number()
      .int()
      .positive()
      .describe(
        "The rev this edit was made against; a newer one answers 409 CONFLICT",
      ),
  })
  .partial();
export type SurfacePatch = z.infer<typeof surfacePatchSchema>;

export const surfaceSourceFieldSchema = z.enum(["head", "html", "css", "js"]);
export type SurfaceSourceField = z.infer<typeof surfaceSourceFieldSchema>;

export const surfaceSourceReadSchema = z
  .object({
    field: surfaceSourceFieldSchema,
    startLine: z.number().int().positive().default(1),
    endLine: z.number().int().positive().optional(),
    offset: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe(
        "Character offset within the selected line range; use nextOffset to continue",
      ),
    maxChars: z.number().int().min(1).max(24_000).default(12_000),
  })
  .refine(
    (value) => value.endLine === undefined || value.endLine >= value.startLine,
    {
      message: "endLine must be at least startLine",
    },
  );

export const surfaceSourceSearchSchema = z.object({
  field: surfaceSourceFieldSchema.optional(),
  query: z.string().min(1).max(2000).describe("Case-sensitive literal text"),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe("Skip this many matches"),
  limit: z.number().int().min(1).max(40).default(20),
});

export const surfaceSourceEditSchema = z.object({
  baseRev: z.number().int().positive(),
  edits: z
    .array(
      z.object({
        field: surfaceSourceFieldSchema,
        oldText: z.string().min(1).max(SURFACE_CODE_MAX),
        newText: z.string().max(SURFACE_CODE_MAX),
      }),
    )
    .min(1)
    .max(100)
    .describe(
      "Applied in order, atomically; each oldText must match exactly once",
    ),
});

export const surfaceSourceImportSchema = z.object({
  baseRev: z.number().int().positive(),
  sources: z
    .array(
      z.object({
        field: surfaceSourceFieldSchema,
        sourceUrl: z
          .url()
          .refine(
            (url) => new URL(url).protocol === "https:",
            "Use an HTTPS URL",
          )
          .describe(
            "Temporary or public download URL for a UTF-8 source file; bytes are fetched and stored",
          ),
      }),
    )
    .min(1)
    .max(4)
    .refine(
      (sources) =>
        new Set(sources.map((source) => source.field)).size === sources.length,
      {
        message: "Each field may only be imported once",
      },
    ),
});

export const surfaceSourceRequestSchema = z.discriminatedUnion("action", [
  surfaceSourceReadSchema.safeExtend({ action: z.literal("source_read") }),
  surfaceSourceSearchSchema.extend({ action: z.literal("source_search") }),
  surfaceSourceEditSchema.extend({ action: z.literal("source_edit") }),
  surfaceSourceImportSchema.extend({ action: z.literal("source_import") }),
]);
export type SurfaceSourceRequest = z.infer<typeof surfaceSourceRequestSchema>;

export const workspaceSurfaceSchema = z.object({
  id: surfaceIdSchema,
  name: z.string(),
  description: z.string(),
  icon: iconValueSchema.nullable(),
  head: z.string(),
  html: z.string(),
  css: z.string(),
  js: z.string(),
  chrome: surfaceChromeSchema,
  mount: surfaceMountSchema,
  assets: z.array(surfaceAssetSchema),
  state: z.record(z.string(), z.unknown()),
  /** Runtime errors the frame reported since the code last changed. */
  errors: z.array(surfaceErrorSchema),
  rev: z.number().int().positive(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkspaceSurface = z.infer<typeof workspaceSurfaceSchema>;

export const workspaceSurfaceSummarySchema = workspaceSurfaceSchema
  .pick({
    id: true,
    name: true,
    description: true,
    icon: true,
    chrome: true,
    mount: true,
    rev: true,
    createdBy: true,
    updatedAt: true,
  })
  .extend({ errorCount: z.number().int().nonnegative() });
export type WorkspaceSurfaceSummary = z.infer<
  typeof workspaceSurfaceSummarySchema
>;

export const surfaceRevisionSchema = z.object({
  rev: z.number().int().positive(),
  actor: z.string(),
  at: z.string(),
  name: z.string(),
  /** Which code fields changed against the previous revision. */
  changed: z.array(z.string()),
});
export type SurfaceRevision = z.infer<typeof surfaceRevisionSchema>;

export const surfaceRevertSchema = z.object({
  rev: z.number().int().positive(),
});

export const surfaceStatePutSchema = z.object({ state: surfaceStateSchema });

export const surfaceErrorsPostSchema = z.object({
  /** The rev of the code that threw; a batch from an older frame is dropped. */
  rev: z.number().int().positive().optional(),
  errors: z
    .array(surfaceErrorSchema.omit({ at: true }))
    .min(1)
    .max(SURFACE_ERRORS_MAX),
});

/** One asset by inline bytes or a public https URL the server fetches. */
export const surfaceAssetAddSchema = z.union([
  z.object({
    name: surfaceAssetNameSchema,
    contentType: z.string().min(1).max(200),
    dataBase64: z.string().min(1),
  }),
  z.object({
    name: surfaceAssetNameSchema,
    sourceUrl: z.url(),
    contentType: z.string().min(1).max(200).optional(),
  }),
]);
export type SurfaceAssetAdd = z.infer<typeof surfaceAssetAddSchema>;

/** A bridge call: any tool on the denizlg24 MCP server, by name. */
export const surfaceCallSchema = z.object({
  tool: z.string().regex(/^[a-z][a-z0-9_]{1,80}$/),
  args: z.record(z.string(), z.unknown()).default({}),
});
export type SurfaceCall = z.infer<typeof surfaceCallSchema>;

export const surfaceCallResultSchema = z.object({
  isError: z.boolean(),
  /** structuredContent when the tool returned it, else the parsed text. */
  result: z.unknown(),
});
export type SurfaceCallResult = z.infer<typeof surfaceCallResultSchema>;
