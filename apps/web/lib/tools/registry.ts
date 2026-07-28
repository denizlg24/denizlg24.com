import { agentMemoryTools } from "./agent-memory";
import { blogTools } from "./blog";
import { calendarTools } from "./calendar";
import { clientTools } from "./client";
import { commentsTools } from "./comments";
import { contactsTools } from "./contacts";
import { coursesTools } from "./courses";
import { emailTools } from "./email";
import { journalTools } from "./journal";
import { kanbanTools } from "./kanban";
import { latexTools } from "./latex";
import { notesTools } from "./notes";
import { nowTools } from "./now";
import { papersTools } from "./papers";
import { peopleTools } from "./people";
import { projectsTools } from "./projects";
import { resourceTools } from "./resources";
import { sandboxTools } from "./sandbox";
import { spreadsheetTools } from "./spreadsheets";
import { subResourceTools } from "./sub-resources";
import { timelineTools } from "./timeline";
import { timetableTools } from "./timetable";
import { todayBoardTools } from "./today-board";
import { triageTools } from "./triage";
import type { ToolDefinition, ToolSchema } from "./types";
import { uploadTools } from "./upload";
import { whiteboardTools } from "./whiteboard";

const allTools: ToolDefinition[] = [
  ...clientTools,
  ...agentMemoryTools,

  // Productivity
  ...kanbanTools,
  ...notesTools,
  ...calendarTools,
  ...timetableTools,
  ...whiteboardTools,
  ...todayBoardTools,
  ...journalTools,

  // Academic
  ...coursesTools,
  ...papersTools,
  ...latexTools,
  ...spreadsheetTools,

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
  ...sandboxTools,
];

const toolMap = new Map<string, ToolDefinition>();
for (const tool of allTools) {
  toolMap.set(tool.schema.name, tool);
}

export function getToolSchemas(): ToolSchema[] {
  return allTools.map((t) => t.schema);
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
