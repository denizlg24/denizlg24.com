import type { McpServer } from "@modelcontextprotocol/server";
import { modelSettingSchema } from "@repo/schemas";
import { z } from "zod";
import {
  type Api,
  action,
  decodeUpload,
  defineActions,
  defineTool,
  multipart,
  p,
  uploadFields,
} from "../define";

const id = z.string().min(1).describe("Mongo _id");
const byId = z.object({ id });

const uploadInput = z.object(uploadFields);

async function upload(
  api: Api,
  path: string,
  { filename, contentType, text, base64 }: z.output<typeof uploadInput>,
) {
  const decoded = decodeUpload({ text, base64 });
  if ("error" in decoded) return decoded.error;
  return multipart(api.web, path, {
    bytes: decoded.bytes,
    filename,
    contentType,
  });
}

export function registerWebMisc(server: McpServer, api: Api) {
  defineTool(server, {
    name: "web_dashboard_stats",
    title: "Web: dashboard stats",
    description: "Counts and recent activity shown on the admin dashboard.",
    input: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: () => api.web.get("/api/admin/dashboard/stats"),
  });

  defineActions(server, {
    name: "web_settings",
    title: "Web: app settings",
    description: "Time zone and default model ids.",
    actions: {
      get: action({
        description: "Current settings",
        readOnly: true,
        run: () => api.web.get("/api/admin/settings"),
      }),
      update: action({
        description:
          "Sets timeZone (IANA or null), semanticModel or unattendedModel (id or null)",
        input: z.object({
          timeZone: z.string().nullable().optional(),
          semanticModel: modelSettingSchema.optional(),
          unattendedModel: modelSettingSchema.optional(),
        }),
        idempotent: true,
        run: (body) => api.web.patch("/api/admin/settings", body),
      }),
    },
  });

  defineActions(server, {
    name: "web_now_page",
    title: "Web: now page",
    description: "Markdown behind the public /now page.",
    actions: {
      get: action({
        description: "Current content",
        readOnly: true,
        run: () => api.web.get("/api/admin/now-page"),
      }),
      update: action({
        description: "Replaces the content",
        input: z.object({ content: z.string() }),
        idempotent: true,
        run: (body) => api.web.put("/api/admin/now-page", body),
      }),
    },
  });

  defineActions(server, {
    name: "web_revalidate",
    title: "Web: revalidate",
    description: "ISR revalidation of public content.",
    actions: {
      run: action({
        description: "Revalidates the given public targets",
        input: z.object({
          targets: z.array(z.enum(["blog", "now", "projects", "timeline"])),
        }),
        idempotent: true,
        run: (body) => api.web.post("/api/admin/revalidate", body),
      }),
    },
  });

  defineActions(server, {
    name: "web_upload",
    title: "Web: upload",
    description: "Uploads to the self-hosted storage; returns url and hash.",
    actions: {
      image: action({
        description: "Uploads to the image bucket",
        input: uploadInput,
        run: (input) => upload(api, "/api/admin/upload", input),
      }),
      file: action({
        description: "Uploads to the file bucket",
        input: uploadInput,
        run: (input) => upload(api, "/api/admin/upload/file", input),
      }),
    },
  });

  defineActions(server, {
    name: "web_instagram_token",
    title: "Web: Instagram token",
    description: "Stored Instagram Graph token.",
    actions: {
      get: action({
        description: "Token metadata",
        readOnly: true,
        run: () => api.web.get("/api/admin/instagram-token"),
      }),
      delete: action({
        description: "Removes the stored token",
        destructive: true,
        run: () => api.web.delete("/api/admin/instagram-token"),
      }),
    },
  });

  defineActions(server, {
    name: "web_api_keys",
    title: "Web: API keys",
    description: "Admin API keys (the authenticator extension uses one).",
    actions: {
      list: action({
        description: "Every key (hashed)",
        readOnly: true,
        run: () => api.web.get("/api/admin/api-keys"),
      }),
      create: action({
        description: "Creates a key; the raw key is returned once",
        input: z.object({ name: z.string().min(1) }),
        run: (body) => api.web.post("/api/admin/api-keys", body),
      }),
      update: action({
        description: "Rotates the key; the new raw key is returned once",
        input: byId,
        run: ({ id }) => api.web.put(p`/api/admin/api-keys/${id}`),
      }),
      delete: action({
        description: "Deletes a key",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/api-keys/${id}`),
      }),
    },
  });
}
