import { blogTools } from "./blog";
import { calendarTools } from "./calendar";
import { clientTools } from "./client";
import { contactsTools } from "./contacts";
import { coursesTools } from "./courses";
import { emailTools } from "./email";
import { kanbanTools } from "./kanban";
import { notesTools } from "./notes";
import { nowTools } from "./now";
import { projectsTools } from "./projects";
import { resourceTools } from "./resources";
import { timelineTools } from "./timeline";
import { timetableTools } from "./timetable";
import type { ToolDefinition, ToolSchema } from "./types";

const allTools: ToolDefinition[] = [
  ...clientTools,

  // Productivity
  ...kanbanTools,
  ...notesTools,
  ...calendarTools,
  ...timetableTools,

  // Academic
  ...coursesTools,

  // Content
  ...blogTools,
  ...projectsTools,
  ...timelineTools,
  ...nowTools,

  // Communication
  ...contactsTools,
  ...emailTools,

  // Infrastructure
  ...resourceTools,
];

const toolMap = new Map<string, ToolDefinition>();
for (const tool of allTools) {
  toolMap.set(tool.schema.name, tool);
}

export function getToolSchemas(): ToolSchema[] {
  return allTools.map((t) => t.schema);
}

export function getReadOnlyToolSchemas(): ToolSchema[] {
  return allTools.filter((t) => !t.isWrite).map((t) => t.schema);
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
