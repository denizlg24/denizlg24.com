import { modelSettingSchema } from "@repo/schemas";
import {
  createConversation,
  deleteConversation,
  getAllConversations,
  getConversation,
  InvalidConversationCursorError,
} from "@/lib/conversations";
import { listModels } from "@/lib/llm-model-catalog";
import {
  getModelSettings,
  type ModelSettingKey,
  setModelSetting,
} from "@/lib/llm-model-settings";
import {
  getAppTimeZone,
  isValidTimeZone,
  setAppTimeZone,
} from "@/lib/timezone";
import type { ToolDefinition } from "./types";

/**
 * App-level settings and the conversation store.
 *
 * The two model settings are not the chat model — they are the models
 * background work runs on, so changing one silently re-points every semantic
 * classification or unattended task that follows.
 */

const MAX_CONVERSATIONS = 50;
const MAX_CATALOG_MODELS = 60;

export const systemTools: ToolDefinition[] = [
  {
    schema: {
      name: "get_app_settings",
      description:
        "The app timezone and the models background work runs on. effectiveTimeZone is what date handling actually uses — it falls back to the deployment default when no timezone is set.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "settings",
    execute: async () => {
      const [effectiveTimeZone, models] = await Promise.all([
        getAppTimeZone(),
        getModelSettings(),
      ]);
      return { effectiveTimeZone, ...models };
    },
  },
  {
    schema: {
      name: "update_app_settings",
      description:
        "Change the app timezone or the background models. semanticModel runs note classification and similar; unattendedModel runs scheduled tasks. Pass null for either to fall back to the default. Timezone affects how every date in the app is bucketed, so change it only when asked to.",
      input_schema: {
        type: "object",
        properties: {
          timeZone: {
            type: "string",
            description:
              "IANA timezone such as Europe/Lisbon, or null to fall back to the deployment default.",
          },
          semanticModel: {
            type: "string",
            description:
              "Fully qualified gateway model id for semantic work, or null for the default.",
          },
          unattendedModel: {
            type: "string",
            description:
              "Fully qualified gateway model id for unattended runs, or null for the default.",
          },
        },
      },
    },
    isWrite: true,
    category: "settings",
    execute: async (input) => {
      const modelKeys: ModelSettingKey[] = ["semanticModel", "unattendedModel"];
      const touched = modelKeys.filter((key) => key in input);
      if (!("timeZone" in input) && touched.length === 0) {
        throw new Error(
          "Pass at least one of timeZone, semanticModel or unattendedModel",
        );
      }

      // Validate everything before writing anything: a call naming a bad model
      // and a good timezone should change neither, not half-apply.
      for (const key of touched) {
        if (!modelSettingSchema.safeParse(input[key]).success) {
          throw new Error(`${key} must be a model id or null`);
        }
      }
      if ("timeZone" in input && input.timeZone !== null) {
        if (
          typeof input.timeZone !== "string" ||
          !isValidTimeZone(input.timeZone)
        ) {
          throw new Error("timeZone must be a valid IANA timezone or null");
        }
      }

      if ("timeZone" in input) {
        await setAppTimeZone(input.timeZone as string | null);
      }
      for (const key of touched) {
        await setModelSetting(key, modelSettingSchema.parse(input[key]));
      }
      const [effectiveTimeZone, models] = await Promise.all([
        getAppTimeZone(),
        getModelSettings(),
      ]);
      return { effectiveTimeZone, ...models };
    },
  },
  {
    schema: {
      name: "list_llm_models",
      description:
        "The Vercel AI Gateway model catalog: fully qualified ids, capability tags and context limits. Use it to pick a model id for update_app_settings or an agent task.",
      input_schema: {
        type: "object",
        properties: {
          creator: {
            type: "string",
            description: "Filter by provider, e.g. anthropic.",
          },
          requiredTag: {
            type: "array",
            items: { type: "string" },
            description: "Only models carrying all of these capability tags.",
          },
        },
      },
    },
    isWrite: false,
    category: "settings",
    execute: async (input) => {
      const result = await listModels({
        creator: input.creator as string | undefined,
        requiredTags: Array.isArray(input.requiredTag)
          ? input.requiredTag.map(String)
          : undefined,
      });
      // The full catalog is hundreds of models with pricing and limits on each.
      // Ids and the few facts a choice turns on are what a caller needs.
      return {
        models: result.models.slice(0, MAX_CATALOG_MODELS).map((model) => ({
          id: model.id,
          name: model.name,
          creator: model.creator,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          tags: model.tags,
        })),
        total: result.models.length,
        truncated: result.models.length > MAX_CATALOG_MODELS,
        stale: result.stale,
        fetchedAt: result.fetchedAt,
      };
    },
  },
  {
    schema: {
      name: "list_conversations",
      description:
        "Past chat conversations, newest first. Titles and metadata only — read one with get_conversation.",
      input_schema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "How many to return, 1-50 (default 20).",
            minimum: 1,
            maximum: 50,
          },
          cursor: {
            type: "string",
            description: "nextCursor from a previous call, to page further.",
          },
        },
      },
    },
    isWrite: false,
    category: "settings",
    execute: async (input) => {
      try {
        return await getAllConversations({
          limit: Math.min(Number(input.limit ?? 20), MAX_CONVERSATIONS),
          cursor: input.cursor as string | undefined,
        });
      } catch (error) {
        if (error instanceof InvalidConversationCursorError) {
          throw new Error("Invalid cursor; omit it to start from the newest");
        }
        throw error;
      }
    },
  },
  {
    schema: {
      name: "get_conversation",
      description:
        "Read one conversation in full, including its messages. Long conversations are large — prefer list_conversations when only the title is needed.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Conversation id." },
        },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "settings",
    execute: async (input) => {
      const conversation = await getConversation(String(input.id ?? ""));
      if (!conversation) throw new Error("Conversation not found");
      return conversation;
    },
  },
  {
    schema: {
      name: "create_conversation",
      description:
        "Start a new conversation thread. Set memoryMode to incognito for one that forms no memories.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Conversation title." },
          llmModel: {
            type: "string",
            description: "Fully qualified gateway model id for the thread.",
          },
          memoryMode: {
            type: "string",
            description: "Defaults to enabled.",
            enum: ["enabled", "incognito"],
          },
        },
        required: ["title", "llmModel"],
      },
    },
    isWrite: true,
    category: "settings",
    execute: async (input) =>
      createConversation({
        title: String(input.title ?? ""),
        llmModel: String(input.llmModel ?? ""),
        memoryMode: input.memoryMode === "incognito" ? "incognito" : "enabled",
      }),
  },
  {
    schema: {
      name: "delete_conversation",
      description:
        "Delete a conversation. Memories formed from it are redacted with it.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Conversation id." },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "settings",
    execute: async (input) => {
      const deleted = await deleteConversation(String(input.id ?? ""));
      if (!deleted) throw new Error("Conversation not found");
      return { success: true };
    },
  },
];
