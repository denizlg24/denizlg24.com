import type { McpServer } from "@modelcontextprotocol/server";
import {
  adminResetMfaInputSchema,
  createPendingUserInputSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import { type Api, defineTool, limit, page } from "../define";

const userId = z.string().min(1).describe("Cloud user id");

export function registerCloudUsers(server: McpServer, api: Api) {
  defineTool(server, {
    name: "cloud_users_list",
    title: "Cloud: users",
    description: "Cloud accounts with role, status and MFA enrolment.",
    input: z.object({ page, limit }),
    annotations: { readOnlyHint: true },
    run: (query) => api.cloud.get("/api/auth/admin/users", query),
  });

  defineTool(server, {
    name: "cloud_user_create_pending",
    title: "Cloud: create pending user",
    description:
      "Creates a pending signup and returns the one-time completion token. The only way to add a user.",
    input: z.object(createPendingUserInputSchema.shape),
    run: (body) => api.cloud.post("/api/auth/admin/create-pending-user", body),
  });

  defineTool(server, {
    name: "cloud_user_remove",
    title: "Cloud: remove user",
    description: "Deletes a user and everything keyed to it.",
    input: z.object({ userId }),
    annotations: { destructiveHint: true },
    run: ({ userId }) =>
      api.cloud.post("/api/auth/admin/remove-user", { userId }),
  });

  defineTool(server, {
    name: "cloud_user_set_password",
    title: "Cloud: set user password",
    description: "Replaces a user's password (8–128 chars).",
    input: z.object({ userId, newPassword: z.string().min(8).max(128) }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: (body) => api.cloud.post("/api/auth/admin/set-user-password", body),
  });

  defineTool(server, {
    name: "cloud_user_reset_mfa",
    title: "Cloud: reset MFA",
    description:
      "Clears a user's TOTP enrolment so they must enrol again at next sign-in.",
    input: z.object(adminResetMfaInputSchema.shape),
    annotations: { destructiveHint: true },
    run: (body) => api.cloud.post("/api/auth/admin/reset-mfa", body),
  });
}
