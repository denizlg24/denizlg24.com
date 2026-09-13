import { isAgentPageTool } from "@repo/schemas";
import { jsonSchema, type ToolSet, tool } from "ai";
import { sandboxEnabled } from "@/lib/sandbox-config";
import { agentMemoryTools } from "@/lib/tools/agent-memory";
import { clientTools } from "@/lib/tools/client";
import { runtimeTools } from "@/lib/tools/runtime";
import type { ToolDefinition, ToolExecutionContext } from "@/lib/tools/types";
import { toJsonSchema7 } from "./json-schema";

const SANDBOX_FILE_TOOLS = new Set([
  "import_sandbox_spreadsheet",
  "upload_sandbox_file",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface BuiltinToolset {
  tools: ToolSet;
  /** Built-in writes; they ask for approval in an interactive turn. */
  writes: ReadonlySet<string>;
}

/**
 * Imported only when a sandbox backend exists: these modules pull the sandbox
 * SDK and storage clients, which a turn without a sandbox never needs.
 */
async function sandboxDefinitions(): Promise<ToolDefinition[]> {
  const [{ sandboxTools }, { spreadsheetTools }, { uploadTools }] =
    await Promise.all([
      import("@/lib/tools/sandbox"),
      import("@/lib/tools/spreadsheets"),
      import("@/lib/tools/upload"),
    ]);
  return [
    ...sandboxTools,
    ...[...spreadsheetTools, ...uploadTools].filter((entry) =>
      SANDBOX_FILE_TOOLS.has(entry.schema.name),
    ),
  ];
}

async function definitions(options: {
  pageTools: boolean;
  memoryWrites: boolean;
}): Promise<ToolDefinition[]> {
  const selected: ToolDefinition[] = [...runtimeTools];
  if (options.memoryWrites) {
    selected.push(
      ...agentMemoryTools.filter(
        (entry) => entry.schema.name === "save_memory",
      ),
    );
  }
  if (options.pageTools) {
    selected.push(
      ...clientTools.filter((entry) => isAgentPageTool(entry.schema.name)),
    );
  }
  if (sandboxEnabled()) selected.push(...(await sandboxDefinitions()));
  return selected;
}

/**
 * What stays in-process: tools that need the attached client, the turn's
 * memory mode or conversation, or the wall clock. Everything else a turn can
 * do comes from a connector.
 */
export async function buildBuiltinTools(options: {
  context: ToolExecutionContext;
  /** A client is attached to the stream and can run page tools. */
  pageTools: boolean;
}): Promise<BuiltinToolset> {
  const tools: ToolSet = {};
  const writes = new Set<string>();
  const memoryWrites = options.context.memoryMode !== "incognito";
  for (const entry of await definitions({
    pageTools: options.pageTools,
    memoryWrites,
  })) {
    const name = entry.schema.name;
    const inputSchema = jsonSchema<Record<string, unknown>>(
      toJsonSchema7(entry.schema.input_schema),
    );
    const execute = entry.execute;
    if (entry.runtime === "client" || !execute) {
      tools[name] = tool({
        description: entry.schema.description,
        inputSchema,
      });
      continue;
    }
    if (entry.isWrite) writes.add(name);
    tools[name] = tool({
      description: entry.schema.description,
      inputSchema,
      execute: (input) =>
        execute(isRecord(input) ? input : {}, options.context),
    });
  }
  return { tools, writes };
}
