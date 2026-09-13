import type { McpServer } from "@modelcontextprotocol/server";
import { agentMemoryModeSchema, chatMessageSchema } from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, limit, p } from "../define";

const conversationId = z.string().min(1).describe("Conversation id");
const byId = z.object({ conversationId });

export function registerWebConversations(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_conversations",
    title: "Web: agent conversations",
    description: "Chat threads with the admin agent.",
    actions: {
      list: action({
        description: "Paged thread metadata, newest first",
        input: z.object({
          offset: z.number().int().min(0).optional(),
          limit,
          cursor: z.string().optional(),
        }),
        readOnly: true,
        run: (query) => api.web.get("/api/admin/conversations", query),
      }),
      get: action({
        description: "One thread with messages",
        input: byId,
        readOnly: true,
        run: ({ conversationId }) =>
          api.web.get(p`/api/admin/conversations/${conversationId}`),
      }),
      create: action({
        description: "Starts a thread (title and model required)",
        input: z.object({
          title: z.string().min(1),
          model: z.string().min(1).describe("Gateway model id"),
          memoryMode: agentMemoryModeSchema.optional(),
        }),
        run: (body) => api.web.post("/api/admin/conversations", body),
      }),
      update: action({
        description: "Sets memoryMode or replaces messages, not both",
        input: z.object({
          conversationId,
          memoryMode: agentMemoryModeSchema.optional(),
          messages: z.array(chatMessageSchema).optional(),
        }),
        idempotent: true,
        run: ({ conversationId, ...body }) =>
          api.web.patch(p`/api/admin/conversations/${conversationId}`, body),
      }),
      delete: action({
        description: "Deletes a thread",
        input: byId,
        destructive: true,
        run: ({ conversationId }) =>
          api.web.delete(p`/api/admin/conversations/${conversationId}`),
      }),
    },
  });
}
