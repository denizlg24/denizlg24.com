import type { ToolDefinition } from "./types";

export const clientTools: ToolDefinition[] = [
  {
    schema: {
      name: "get_current_page_context",
      description:
        "Read the desktop page currently visible to Deniz, including its route, title, selection, and concise visible text.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "desktop",
    runtime: "client",
  },
  {
    schema: {
      name: "read_current_page_aloud",
      description:
        "Speak the selected text, or the visible desktop page when nothing is selected. Use this when Deniz asks you to read the page aloud.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "desktop",
    runtime: "client",
  },
  {
    schema: {
      name: "stop_reading_aloud",
      description: "Stop text-to-speech playback started by the desktop agent.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "desktop",
    runtime: "client",
  },
  {
    schema: {
      name: "navigate_desktop",
      description:
        "Navigate the desktop app to another dashboard route. Use an absolute /dashboard/... path.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute dashboard path.",
          },
        },
        required: ["path"],
      },
    },
    isWrite: true,
    category: "desktop",
    runtime: "client",
  },
  {
    schema: {
      name: "refresh_current_page",
      description: "Refresh the data on the currently visible desktop page.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: true,
    category: "desktop",
    runtime: "client",
  },
];

/**
 * Asks Deniz and waits for the answer, which resumes the same turn. Offered
 * only to a client that draws the questionnaire, and never unattended.
 */
export const questionTool: ToolDefinition = {
  schema: {
    name: "ask_user",
    description:
      "Ask Deniz one to four multiple-choice questions and wait for his answers before continuing. Use it when a decision is genuinely his and the options are clear — not to confirm something you can just do. Each question has 2-8 short options; he can also type his own answer. The result is { answers: [{ id, selected, other? }] }, or { dismissed: true } if he skipped it.",
    input_schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                maxLength: 64,
                description: "Stable key, e.g. 'scope'.",
              },
              question: { type: "string", maxLength: 500 },
              header: {
                type: "string",
                maxLength: 32,
                description: "One or two words shown above the question.",
              },
              options: {
                type: "array",
                minItems: 2,
                maxItems: 8,
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", maxLength: 120 },
                    description: { type: "string", maxLength: 300 },
                  },
                  required: ["label"],
                },
              },
              multiSelect: { type: "boolean" },
            },
            required: ["id", "question", "options"],
          },
        },
      },
      required: ["questions"],
    },
  },
  isWrite: false,
  category: "desktop",
  runtime: "client",
};
