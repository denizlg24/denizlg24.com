import type { McpServer } from "@modelcontextprotocol/server";
import { totpAlgorithmSchema } from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p, partial } from "../define";

const base = "/api/admin/authenticator";
const id = z.string().min(1).describe("Mongo _id");
const byId = z.object({ id });

const labelFields = {
  label: z.string().min(1),
  issuer: z.string().optional(),
  accountName: z.string().optional(),
};

export function registerWebAuthenticator(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_authenticator",
    title: "Web: authenticator",
    description: "TOTP accounts and their current codes; secrets never leave.",
    actions: {
      list: action({
        description: "Every account without secrets",
        readOnly: true,
        run: () => api.web.get(base),
      }),
      codes: action({
        description: "Current server-computed codes",
        readOnly: true,
        run: () => api.web.get(`${base}/codes`),
      }),
      create: action({
        description: "Adds an account from a base32 secret",
        input: z.object({
          ...labelFields,
          secret: z.string().min(1).describe("Base32"),
          algorithm: totpAlgorithmSchema.optional(),
          digits: z.number().int().optional(),
          period: z.number().int().optional(),
        }),
        run: (body) => api.web.post(base, body),
      }),
      update: action({
        description: "Changes label, issuer or accountName",
        input: z.object({ id, ...partial(labelFields) }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/authenticator/${id}`, body),
      }),
      delete: action({
        description: "Deletes an account",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/authenticator/${id}`),
      }),
      import: action({
        description: "Imports up to 100 otpauth:// URIs",
        input: z.object({ uris: z.array(z.string().min(1)).min(1).max(100) }),
        run: (body) => api.web.post(`${base}/import`, body),
      }),
    },
  });
}
