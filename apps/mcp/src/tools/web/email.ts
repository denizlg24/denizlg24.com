import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type Api, action, defineActions, limit, p, page } from "../define";

const id = z.string().min(1).describe("Email account id");
const byId = z.object({ id });
const emailId = z.string().min(1).describe("Stored email id");

const provider = z.enum(["custom", "gmail", "outlook", "yahoo", "icloud"]);
const port = z.number().int().min(1).max(65535);

const accountFields = {
  provider: provider.optional(),
  displayName: z.string().max(120).optional(),
  host: z.string().min(1).max(255).optional(),
  port: port.optional(),
  secure: z.boolean().optional(),
  user: z.email().max(320),
  inboxName: z.string().min(1).max(120).optional(),
  smtpEnabled: z.boolean().optional(),
  smtpHost: z.string().min(1).max(255).optional(),
  smtpPort: port.optional(),
  smtpSecure: z.boolean().optional(),
  smtpRequireTls: z.boolean().optional(),
  smtpUser: z.email().max(320).optional(),
  smtpPassword: z.string().max(1000).optional(),
  useSameCredentialsForSending: z.boolean().optional(),
  smtpFromName: z.string().max(120).optional(),
  smtpFromAddress: z.email().max(320).optional(),
};

export function registerWebEmail(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_email_accounts",
    title: "Web: email accounts",
    description: "IMAP/SMTP accounts synced into the inbox.",
    actions: {
      list: action({
        description: "Every account without secrets",
        readOnly: true,
        run: () => api.web.get("/api/admin/email-accounts"),
      }),
      create: action({
        description: "Adds an account; user and password required",
        input: z.object({
          ...accountFields,
          password: z.string().min(1).max(1000),
        }),
        run: (body) => api.web.post("/api/admin/email-accounts", body),
      }),
      update: action({
        description: "Changes settings; IMAP password is not updatable here",
        input: z.object({
          id,
          ...accountFields,
          user: accountFields.user.optional(),
        }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/email-accounts/${id}`, body),
      }),
      delete: action({
        description: "Deletes an account and its stored mail",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/email-accounts/${id}`),
      }),
      sync: action({
        description: "Syncs one inbox now",
        input: byId,
        run: ({ id }) => api.web.post(p`/api/admin/email-accounts/${id}/sync`),
      }),
      sync_all: action({
        description: "Syncs every account",
        run: () => api.web.post("/api/admin/email-accounts/sync"),
      }),
    },
  });

  defineActions(server, {
    name: "web_emails",
    title: "Web: emails",
    description: "Stored mail per account.",
    actions: {
      list: action({
        description: "Paged messages of an account",
        input: z.object({
          id,
          page,
          limit,
          search: z.string().optional(),
        }),
        readOnly: true,
        run: ({ id, ...query }) =>
          api.web.get(p`/api/admin/email-accounts/${id}/emails`, query),
      }),
      get: action({
        description: "Full message with body; marks it seen",
        input: z.object({ id, emailId }),
        readOnly: true,
        run: ({ id, emailId }) =>
          api.web.get(p`/api/admin/email-accounts/${id}/emails/${emailId}`),
      }),
      attachments: action({
        description: "Attachment list (name, type, size); bytes not returned",
        input: z.object({ id, emailId }),
        readOnly: true,
        run: ({ id, emailId }) =>
          api.web.get(
            p`/api/admin/email-accounts/${id}/emails/${emailId}/attachments`,
          ),
      }),
      send: action({
        description: "Sends mail through the account's SMTP",
        input: z.object({
          id,
          to: z.array(z.email()).min(1),
          cc: z.array(z.email()).optional(),
          bcc: z.array(z.email()).optional(),
          subject: z.string().max(300).optional(),
          text: z.string().min(1).max(100_000),
          html: z.string().max(200_000).optional(),
          replyToMessageId: z.string().max(500).optional(),
        }),
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/email-accounts/${id}/send`, body),
      }),
    },
  });
}
