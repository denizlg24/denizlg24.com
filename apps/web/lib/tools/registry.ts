import { sandboxEnabled } from "../sandbox-config";
import { agentMemoryTools } from "./agent-memory";
import { agentTaskTools } from "./agent-tasks";
import { authenticatorTools } from "./authenticator";
import { blogTools } from "./blog";
import { calendarTools } from "./calendar";
import { clientTools } from "./client";
import { commentsTools } from "./comments";
import { contactsTools } from "./contacts";
import { coursesTools } from "./courses";
import { cvTools } from "./cv";
import { emailTools } from "./email";
import { financeTools } from "./finance";
import { financeBudgetTools } from "./finance-budget";
import { journalTools } from "./journal";
import { kanbanTools } from "./kanban";
import { latexTools } from "./latex";
import { marketsTools } from "./markets";
import { notesTools } from "./notes";
import { nowTools } from "./now";
import { papersTools } from "./papers";
import { peopleTools } from "./people";
import { picronTools } from "./picron";
import { projectsTools } from "./projects";
import { resourceTools } from "./resources";
import { runtimeTools } from "./runtime";
import { sandboxTools } from "./sandbox";
import { semanticTools } from "./semantic";
import { spreadsheetTools } from "./spreadsheets";
import { subResourceTools } from "./sub-resources";
import { systemTools } from "./system";
import { timelineTools } from "./timeline";
import { timetableTools } from "./timetable";
import { todayBoardTools } from "./today-board";
import { triageTools } from "./triage";
import type { ToolDefinition, ToolSchema } from "./types";
import { uploadTools } from "./upload";
import { voiceNotesTools } from "./voice-notes";
import { whiteboardTools } from "./whiteboard";

const allTools: ToolDefinition[] = [
  ...clientTools,
  ...agentMemoryTools,
  ...agentTaskTools,

  // Productivity
  ...kanbanTools,
  ...notesTools,
  ...voiceNotesTools,
  ...calendarTools,
  ...timetableTools,
  ...whiteboardTools,
  ...todayBoardTools,
  ...journalTools,
  ...semanticTools,

  // Academic
  ...coursesTools,
  ...papersTools,
  ...latexTools,
  ...cvTools,
  ...spreadsheetTools,

  // Markets
  ...marketsTools,

  // Finance
  ...financeTools,
  ...financeBudgetTools,

  // People
  ...peopleTools,

  // Content
  ...blogTools,
  ...projectsTools,
  ...timelineTools,
  ...nowTools,
  ...commentsTools,
  ...uploadTools,

  // Communication
  ...contactsTools,
  ...emailTools,
  ...triageTools,

  // Infrastructure
  ...resourceTools,
  ...subResourceTools,
  ...picronTools,
  ...sandboxTools,

  // System
  ...runtimeTools,
  ...systemTools,
  ...authenticatorTools,
];

/**
 * Tools that cannot work without a sandbox backend. Two of them do not live in
 * `sandbox.ts` — they read a file *out of* a sandbox that can no longer be
 * created — which is why this is a name list rather than a module boundary.
 *
 * Advertising a tool that always fails costs a turn every time the model
 * reaches for it, and it reaches for the sandbox on exactly the tasks nothing
 * else covers. Dropping them is what stops that; they return the moment
 * SANDBOX_API_URL points at a working deployment.
 */
const SANDBOX_DEPENDENT_TOOLS = new Set([
  ...sandboxTools.map((tool) => tool.schema.name),
  "import_sandbox_spreadsheet",
  "upload_sandbox_file",
]);

const availableTools = sandboxEnabled()
  ? allTools
  : allTools.filter((tool) => !SANDBOX_DEPENDENT_TOOLS.has(tool.schema.name));

const toolMap = new Map<string, ToolDefinition>();
for (const tool of availableTools) {
  toolMap.set(tool.schema.name, tool);
}

export function getToolSchemas(): ToolSchema[] {
  return availableTools.map((t) => t.schema);
}

export function getToolByName(name: string): ToolDefinition | undefined {
  return toolMap.get(name);
}

export function isWriteTool(name: string): boolean {
  return toolMap.get(name)?.isWrite ?? false;
}

export function isClientTool(name: string): boolean {
  return toolMap.get(name)?.runtime === "client";
}
