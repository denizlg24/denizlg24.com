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
    description: `Whole-window apps written as head/html/css/js and run in a sandboxed iframe in Deniz's desktop and web admin, mounted in place of Home (mount {kind:'home'}) or of a module (mount {kind:'module', module:'notes'}), or left unmounted (kind 'none'). The code runs in his browser with the window.deniz bridge, which reaches every tool on this server: treat what you write as running with his full access. get returns the whole surface including errors, the runtime errors its frame reported — read it after every create or update to check your work. Mounting replaces whichever surface held that mount; chrome 'none' is the whole window (with an exit control), 'sidebar' keeps the workspace sidebar. {{asset:<name>}} in head/html/css/js is replaced by an uploaded asset's URL (assets up to ${SURFACE_ASSET_MAX_BYTES / 1024 / 1024} MB). Every code change is a revision: prefer update over recreate, and revert to go back.`,
    actions: {
      list: action({
        description: "Every surface: id, name, mount, chrome, rev",
        readOnly: true,
        run: () => api.web.get(SURFACES),
      }),
      get: action({
        description:
          "One surface with its code, assets, state and reported errors",
        input: z.object({ id }),
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/workspace/surfaces/${id}`),
      }),
      create: action({
        description: "A new surface; returns it with its id",
        input: surfaceInputSchema,
        run: (body) => api.web.post(SURFACES, body),
      }),
      update: action({
        description:
          "Replaces the named fields only (name, description, icon, head, html, css, js, chrome, mount); each code field is replaced whole, so get first and send back the full text of what you change",
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
