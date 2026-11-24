import type { McpServer } from "@modelcontextprotocol/server";
import {
  SURFACE_ASSET_MAX_BYTES,
  surfaceAssetAddSchema,
  surfaceAssetNameSchema,
  surfaceChromeSchema,
  surfaceIdSchema,
  surfaceInputSchema,
  surfaceMountSchema,
  surfacePatchSchema,
  surfaceRevertSchema,
  surfaceSourceEditSchema,
  surfaceSourceImportSchema,
  surfaceSourceReadSchema,
  surfaceSourceSearchSchema,
  surfaceStateSchema,
} from "@repo/schemas";
import { z } from "zod";
import {
  type Api,
  action,
  defineActions,
  fail,
  isRecord,
  mapResult,
  p,
} from "../define";

const SURFACES = "/api/admin/workspace/surfaces";
const id = surfaceIdSchema;
const assetName = surfaceAssetNameSchema;

export function registerWebWorkspaceSurfaces(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_workspace_surfaces",
    title: "Web: workspace surfaces",
    description: `Whole-window apps written as head/html/css/js and run in a sandboxed iframe in Deniz's desktop and web admin, mounted in place of Home (mount {kind:'home'}) or of a module (mount {kind:'module', module:'notes'}), or left unmounted (kind 'none'). The code runs in his browser with the window.deniz bridge, which reaches every tool on this server: treat what you write as running with his full access. After writes, use get with includeSource:false to check reported runtime errors without reading all code. Prefer source_search/source_read and source_edit for routine changes; source_import fetches large replacements from uploaded file URLs. Mounting replaces whichever surface held that mount; chrome 'none' is the whole window (with an exit control), 'sidebar' keeps the workspace sidebar. {{asset:<name>}} in head/html/css/js is replaced by an uploaded asset's URL (assets up to ${SURFACE_ASSET_MAX_BYTES / 1024 / 1024} MB). Every code change is a revision: edit the existing surface and revert to go back.`,
    actions: {
      list: action({
        description: "Every surface: id, name, mount, chrome, rev",
        readOnly: true,
        run: () => api.web.get(SURFACES),
      }),
      get: action({
        description:
          "One surface with its code, assets, state and reported errors",
        input: z.object({
          id,
          includeSource: z
            .boolean()
            .optional()
            .describe("Set false for metadata and runtime errors without code"),
        }),
        readOnly: true,
        run: ({ id, includeSource }) =>
          api.web.get(p`/api/admin/workspace/surfaces/${id}`, {
            includeSource,
          }),
      }),
      source_read: action({
        description:
          "Read one source field by line range, bounded by maxChars (default 12000, max 24000). Text has no line-number prefixes. Continue the same range with nextOffset; rev is used as baseRev when editing.",
        input: surfaceSourceReadSchema.safeExtend({ id }),
        readOnly: true,
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/workspace/surfaces/${id}/source`, {
            action: "source_read",
            ...body,
          }),
      }),
      source_search: action({
        description:
          "Search literal, case-sensitive text in one or all source fields. Returns bounded snippets with 1-based line/column and character offsets; paginate with nextOffset.",
        input: surfaceSourceSearchSchema.extend({ id }),
        readOnly: true,
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/workspace/surfaces/${id}/source`, {
            action: "source_search",
            ...body,
          }),
      }),
      source_edit: action({
        description:
          "Preferred for routine code edits: exact oldText/newText replacements, in order, across fields, as one revision. Every oldText must occur exactly once. Requires baseRev; any mismatch or conflict leaves all source unchanged. Returns only revision, changed fields and edit count.",
        input: surfaceSourceEditSchema.extend({ id }),
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/workspace/surfaces/${id}/source`, {
            action: "source_edit",
            ...body,
          }),
      }),
      source_import: action({
        description:
          "Large replacements: download UTF-8 source files from public or temporary HTTPS sourceUrl values into named fields, atomically as one revision. Requires baseRev. Upload local files outside MCP first, then pass their download URLs; never inline base64. Source is stored, not linked at runtime. Returns compact revision metadata.",
        input: surfaceSourceImportSchema.extend({ id }),
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/workspace/surfaces/${id}/source`, {
            action: "source_import",
            ...body,
          }),
      }),
      create: action({
        description: "A new surface; returns it with its id",
        input: surfaceInputSchema,
        run: (body) => api.web.post(SURFACES, body),
      }),
      update: action({
        description:
          "Replaces the named fields only (name, description, icon, head, html, css, js, chrome, mount); each code field is replaced whole. Prefer source_edit for targeted changes or source_import for large replacements",
        input: z.object({ id, ...surfacePatchSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/workspace/surfaces/${id}`, body),
      }),
      delete: action({
        description: "Deletes a surface, its assets and its history",
        input: z.object({ id }),
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/workspace/surfaces/${id}`),
      }),
      history: action({
        description:
          "Revisions, newest first: rev, actor, time, fields changed",
        input: z.object({
          id,
          limit: z.number().int().min(1).max(200).optional(),
        }),
        readOnly: true,
        run: ({ id, limit }) =>
          api.web.get(p`/api/admin/workspace/surfaces/${id}/history`, {
            limit,
          }),
      }),
      revert: action({
        description: "Restores the code of an earlier revision as a new one",
        input: z.object({ id, ...surfaceRevertSchema.shape }),
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/workspace/surfaces/${id}/revert`, body),
      }),
      mount: action({
        description:
          "Puts the surface in place of Home or a module (replacing whichever surface held it), or kind 'none' to unmount; optionally sets chrome. Only when Deniz asked for it to replace something",
        input: z.object({
          id,
          mount: surfaceMountSchema,
          chrome: surfaceChromeSchema.optional(),
        }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/workspace/surfaces/${id}`, body),
      }),
      asset_add: action({
        description:
          "Uploads a sprite, font, image or audio file as an asset, from inline base64 (dataBase64 + contentType) or a public https sourceUrl the server fetches; an existing name is replaced. Use it as {{asset:<name>}} or deniz.asset(name)",
        input: z.object({
          id,
          name: assetName,
          contentType: z.string().min(1).max(200).optional(),
          dataBase64: z.string().min(1).optional(),
          sourceUrl: z.url().optional(),
        }),
        run: ({ id, ...body }) => {
          const parsed = surfaceAssetAddSchema.safeParse(body);
          if (!parsed.success) {
            return Promise.resolve(
              fail(
                null,
                "Send either dataBase64 with contentType, or sourceUrl",
              ),
            );
          }
          return api.web.post(
            p`/api/admin/workspace/surfaces/${id}/assets`,
            parsed.data,
          );
        },
      }),
      asset_remove: action({
        description: "Removes an asset; {{asset:<name>}} references go dead",
        input: z.object({ id, name: assetName }),
        destructive: true,
        run: ({ id, name }) =>
          api.web.delete(p`/api/admin/workspace/surfaces/${id}/assets/${name}`),
      }),
      state_get: action({
        description: "The state the surface persisted through deniz.state",
        input: z.object({ id }),
        readOnly: true,
        run: async ({ id }) =>
          mapResult(
            await api.web.get(p`/api/admin/workspace/surfaces/${id}`),
            (value) => {
              const surface = isRecord(value) ? value.surface : undefined;
              return { state: isRecord(surface) ? (surface.state ?? {}) : {} };
            },
          ),
      }),
      state_set: action({
        description: "Replaces the surface's whole persisted state",
        input: z.object({ id, state: surfaceStateSchema }),
        idempotent: true,
        run: ({ id, state }) =>
          api.web.put(p`/api/admin/workspace/surfaces/${id}/state`, { state }),
      }),
      errors_clear: action({
        description:
          "Clears the reported runtime errors, so the next ones are only from the current code",
        input: z.object({ id }),
        idempotent: true,
        run: ({ id }) =>
          api.web.delete(p`/api/admin/workspace/surfaces/${id}/errors`),
      }),
    },
  });
}
