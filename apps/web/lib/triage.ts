import type Anthropic from "@anthropic-ai/sdk";
import mongoose from "mongoose";
import { createCalendarEvent } from "@/lib/calendar-events";
import { fetchEmailBody } from "@/lib/email";
import { createCard } from "@/lib/kanban";
import { anthropic, calculateCost, logLlmUsage } from "@/lib/llm";
import { connectDB } from "@/lib/mongodb";
import { findTriageShortcut, type ShortcutRule } from "@/lib/triage-shortcuts";
import { EmailModel } from "@/models/Email";
import {
  EmailTriageModel,
  type TriageCategory,
  type TriagePriority,
} from "@/models/EmailTriage";
import { KanbanBoard } from "@/models/KanbanBoard";
import type { KanbanPriority } from "@/models/KanbanCard";
import { KanbanColumn } from "@/models/KanbanColumn";
import {
  getOrCreateTriageSettings,
  type ICategoryRouting,
  type ITriageSettings,
  normalizeCategoryRouting,
} from "@/models/TriageSettings";

const CATEGORIES: TriageCategory[] = [
  "spam",
  "newsletter",
  "promo",
  "purchases",
  "fyi",
  "action-needed",
  "scheduled",
];

const PRIORITIES: TriagePriority[] = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
];

type TriageBodyMode = "classification" | "extraction";

interface ClassificationResult {
  category: TriageCategory;
  confidence: number;
  summary: string;
  needsTaskExtraction: boolean;
  needsEventExtraction: boolean;
}

interface ExtractionResult {
  tasks: {
    title: string;
    description?: string;
    priority: TriagePriority;
    dueDate?: Date;
    kanbanBoardId?: string;
    kanbanBoardTitle?: string;
    kanbanColumnId?: string;
    kanbanColumnTitle?: string;
  }[];
  events: {
    title: string;
    date: Date;
    place?: string;
  }[];
}

interface FullTriageResult extends ClassificationResult, ExtractionResult {}

interface CompactKanbanTarget {
  key: string;
  boardId: string;
  boardTitle: string;
  columnId: string;
  columnTitle: string;
}

interface TriageRunStats {
  scanned: number;
  prefilteredSpam: number;
  fullTriaged: number;
  autoAcceptedTasks: number;
  autoAcceptedEvents: number;
  errors: number;
}

interface TriageEmailContext {
  subject: string;
  from: { name: string | undefined; address: string }[];
  date: Date;
}

interface PrefilterEmailCandidate {
  _id: string;
  subject: string;
  from: TriageEmailContext["from"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTriagePriority(value: unknown): value is TriagePriority {
  return (
    typeof value === "string" &&
    PRIORITIES.some((priority) => priority === value)
  );
}

function isTriageCategory(value: unknown): value is TriageCategory {
  return (
    typeof value === "string" &&
    CATEGORIES.some((category) => category === value)
  );
}

function getStringOverride(
  overrides: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = overrides?.[key];
  return typeof value === "string" ? value : undefined;
}

function getDateOverride(
  overrides: Record<string, unknown> | undefined,
  key: string,
): Date | undefined {
  const value = getStringOverride(overrides, key);
  return value ? parseDate(value) : undefined;
}

function formatFrom(from: TriageEmailContext["from"]): string {
  return from
    .map((entry) =>
      entry.name ? `${entry.name} <${entry.address}>` : entry.address,
    )
    .join(", ");
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function coercePriority(value: unknown): TriagePriority {
  return isTriagePriority(value) ? value : "medium";
}

function coerceCategory(value: unknown): TriageCategory {
  return isTriageCategory(value) ? value : "fyi";
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function getBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeSummary(summary: unknown, fallback: string): string {
  const normalized =
    typeof summary === "string" && summary.trim().length > 0
      ? summary.replace(/\s+/g, " ").trim()
      : fallback.replace(/\s+/g, " ").trim();

  if (normalized.length <= 160) {
    return normalized;
  }

  return `${normalized.slice(0, 157).trimEnd()}...`;
}

function normalizeLine(line: string): string {
  return line
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(line: string): string {
  return normalizeLine(line).toLowerCase();
}

function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isNaN(codePoint) ? " " : String.fromCodePoint(codePoint);
    })
    .replace(/&#(\d+);/g, (_, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isNaN(codePoint) ? " " : String.fromCodePoint(codePoint);
    });
}

function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(
        /<\/(p|div|section|article|header|footer|tr|table|ul|ol|li|h[1-6])>/gi,
        "\n",
      )
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " "),
  );
}

function isUrlOnlyLine(line: string): boolean {
  const stripped = line.replace(/[()[\]<>.,!?;:'"-]+/g, "").trim();
  return /^(https?:\/\/|www\.)\S+$/i.test(stripped);
}

function isDividerLine(line: string): boolean {
  return /^[\W_=-]{6,}$/.test(line);
}

function isLikelyBoilerplate(line: string): boolean {
  return [
    /\bunsubscribe\b/i,
    /\bmanage preferences\b/i,
    /\bemail preferences\b/i,
    /\bnotification settings\b/i,
    /\bprivacy policy\b/i,
    /\bview (this email|in browser|online)\b/i,
    /\bupdate your preferences\b/i,
    /\bno longer wish to receive\b/i,
    /\bopt out\b/i,
    /\ball rights reserved\b/i,
    /^sent from my (iphone|ipad|android)\b/i,
  ].some((pattern) => pattern.test(line));
}

function isReplyHeaderLine(line: string): boolean {
  return /^(from|sent|to|cc|subject|date):\s/i.test(line);
}

function isReplyBoundary(lines: string[], index: number): boolean {
  const line = lines[index];

  if (
    /^on .+wrote:$/i.test(line) ||
    /^begin forwarded message:?$/i.test(line) ||
    /^-+\s*(original|forwarded) message\s*-+$/i.test(line)
  ) {
    return true;
  }

  if (!isReplyHeaderLine(line)) {
    return false;
  }

  let nearbyHeaderCount = 1;
  for (let offset = 1; offset <= 3; offset++) {
    const nextLine = lines[index + offset];
    if (nextLine && isReplyHeaderLine(nextLine)) {
      nearbyHeaderCount++;
    }
  }

  return nearbyHeaderCount >= 2;
}

function isSalientLine(line: string): boolean {
  const dateOrTimePattern =
    /\b(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?|\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|\d{1,2}\s?(am|pm))\b/i;
  const actionPattern =
    /\b(action required|required|deadline|due|reply|respond|confirm|submit|complete|review|approve|register|renew|pay|schedule|interview|meeting|appointment|call|rsvp|by\s+\w+)/i;

  return dateOrTimePattern.test(line) || actionPattern.test(line);
}

function joinLinesWithinCharLimit(lines: string[], limit: number): string {
  if (limit <= 0) {
    return "";
  }

  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const normalized = normalizeKey(line);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(line);
  }

  const output: string[] = [];
  let used = 0;

  for (const line of deduped) {
    const separatorLength = output.length > 0 ? 1 : 0;
    if (used + separatorLength + line.length > limit) {
      break;
    }

    output.push(line);
    used += separatorLength + line.length;
  }

  return output.join("\n");
}

function buildTriageSnippet(
  primaryLines: string[],
  salientLines: string[],
  limit: number,
): string {
  const primaryKeys = new Set(primaryLines.map(normalizeKey));
  const extraSalientLines = salientLines.filter(
    (line) => !primaryKeys.has(normalizeKey(line)),
  );

  const salientBudget = Math.min(Math.floor(limit * 0.35), 700);
  const salientBody = joinLinesWithinCharLimit(
    extraSalientLines,
    salientBudget,
  );
  const salientPrefix = salientBody ? "\n\nSalient lines:\n" : "";
  const reservedForSalient = salientBody.length + salientPrefix.length;
  const primaryBudget = Math.max(
    limit - reservedForSalient,
    Math.floor(limit * 0.65),
  );
  const primaryBody = joinLinesWithinCharLimit(primaryLines, primaryBudget);
  const combined = `${primaryBody}${salientPrefix}${salientBody}`
    .trim()
    .slice(0, limit)
    .trim();

  return combined;
}

function normalizeBodyForTriage(
  text: string,
  html: string,
  mode: TriageBodyMode,
): string {
  const limit = mode === "classification" ? 1800 : 3000;
  const source = (text.trim().length > 0 ? text : htmlToPlainText(html))
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!source) {
    return "";
  }

  const rawLines = source.split("\n").map(normalizeLine);
  const fallbackLines: string[] = [];
  const primaryLines: string[] = [];
  const salientLines: string[] = [];
  const seenSalient = new Set<string>();
  let inReplyChain = false;

  for (let index = 0; index < rawLines.length; index++) {
    const line = rawLines[index];
    if (
      !line ||
      isDividerLine(line) ||
      isUrlOnlyLine(line) ||
      isLikelyBoilerplate(line)
    ) {
      continue;
    }

    if (line.startsWith(">")) {
      continue;
    }

    if (isSalientLine(line)) {
      const key = normalizeKey(line);
      if (!seenSalient.has(key)) {
        seenSalient.add(key);
        salientLines.push(line);
      }
    }

    fallbackLines.push(line);

    if (!inReplyChain && isReplyBoundary(rawLines, index)) {
      inReplyChain = true;
      continue;
    }

    if (!inReplyChain) {
      primaryLines.push(line);
    }
  }

  const bodyLines = primaryLines.length > 0 ? primaryLines : fallbackLines;
  return buildTriageSnippet(bodyLines, salientLines, limit);
}

function getToolInput(
  content: Anthropic.ContentBlock[],
  toolName: string,
): Record<string, unknown> | undefined {
  for (const block of content) {
    if (
      block.type === "tool_use" &&
      block.name === toolName &&
      isRecord(block.input)
    ) {
      return block.input;
    }
  }

  return undefined;
}

async function runPrefilter(
  model: string,
  emails: PrefilterEmailCandidate[],
): Promise<string[]> {
  if (emails.length === 0) {
    return [];
  }

  const system =
    "You are an email spam prefilter. Return only the IDs of definite spam, phishing, bulk promotional junk, or obvious marketing noise. Be conservative: if an email is not clearly spam, omit it.";

  const userContent = JSON.stringify(
    emails.map((email) => ({
      id: email._id,
      subject: email.subject,
      from: formatFrom(email.from),
    })),
  );

  const response = await anthropic.messages.create({
    model: model as Anthropic.Model,
    max_tokens: Math.min(80 + emails.length * 40, 600),
    temperature: 0,
    system,
    tools: [
      {
        name: "return_spam_ids",
        description:
          "Return the IDs of only the emails that are definite spam and can be safely prefiltered.",
        input_schema: {
          type: "object",
          properties: {
            spamIds: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["spamIds"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: {
      type: "tool",
      name: "return_spam_ids",
      disable_parallel_tool_use: true,
    },
    messages: [{ role: "user", content: userContent }],
  });

  const input = getToolInput(response.content, "return_spam_ids");
  const validIds = new Set(emails.map((email) => email._id));
  const spamIds = Array.isArray(input?.spamIds)
    ? Array.from(
        new Set(
          input.spamIds.filter(
            (value): value is string =>
              typeof value === "string" && validIds.has(value),
          ),
        ),
      )
    : [];

  const cost = calculateCost(
    model,
    response.usage.input_tokens,
    response.usage.output_tokens,
  );
  logLlmUsage({
    llmModel: model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    costUsd: cost,
    systemPrompt: system,
    userPrompt: userContent.slice(0, 2000),
    source: "email-triage-prefilter-v2",
  });

  return spamIds;
}

async function getKanbanTargets(): Promise<CompactKanbanTarget[]> {
  const boards = await KanbanBoard.find({ isArchived: false })
    .select("title")
    .sort({ createdAt: -1 })
    .lean();

  if (boards.length === 0) {
    return [];
  }

  const boardIds = boards.map((board) => board._id);
  const columns = await KanbanColumn.find({ boardId: { $in: boardIds } })
    .select("boardId title order")
    .sort({ order: 1 })
    .lean();

  const columnsByBoard = new Map<string, typeof columns>();
  for (const column of columns) {
    const boardId = column.boardId.toString();
    const existing = columnsByBoard.get(boardId);
    if (existing) {
      existing.push(column);
    } else {
      columnsByBoard.set(boardId, [column]);
    }
  }

  const targets: CompactKanbanTarget[] = [];
  let counter = 1;

  for (const board of boards) {
    const boardId = board._id.toString();
    for (const column of columnsByBoard.get(boardId) ?? []) {
      targets.push({
        key: `K${counter++}`,
        boardId,
        boardTitle: board.title,
        columnId: column._id.toString(),
        columnTitle: column.title,
      });
    }
  }

  return targets;
}

function formatKanbanTargets(targets: CompactKanbanTarget[]): string {
  if (targets.length === 0) {
    return "No kanban targets are currently available.";
  }

  return targets
    .map(
      (target) =>
        `- ${target.key}: ${target.boardTitle} / ${target.columnTitle}`,
    )
    .join("\n");
}

function resolveTaskKanbanTarget(
  kanbanTargetKey: unknown,
  targets: CompactKanbanTarget[],
):
  | Pick<
      ExtractionResult["tasks"][number],
      | "kanbanBoardId"
      | "kanbanBoardTitle"
      | "kanbanColumnId"
      | "kanbanColumnTitle"
    >
  | undefined {
  if (typeof kanbanTargetKey !== "string") {
    return undefined;
  }

  const target = targets.find((candidate) => candidate.key === kanbanTargetKey);
  if (!target) {
    return undefined;
  }

  return {
    kanbanBoardId: target.boardId,
    kanbanBoardTitle: target.boardTitle,
    kanbanColumnId: target.columnId,
    kanbanColumnTitle: target.columnTitle,
  };
}

function buildClassificationTool(): Anthropic.Tool {
  return {
    name: "classify_email",
    description:
      "Classify the email, write a short summary, and decide whether task extraction and event extraction are needed.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: CATEGORIES,
          description:
            "spam = junk/phishing/bulk-marketing; newsletter = legit subscription digest; promo = transactional marketing from known sender; purchases = receipts, invoices, order confirmations, or payment notices that do not need follow-up; fyi = informational, no action needed; action-needed = requires a reply/follow-up/task; scheduled = contains a specific meeting/appointment/event time.",
        },
        confidence: {
          type: "number",
          description: "0..1 confidence for the classification.",
        },
        summary: {
          type: "string",
          description: "One short sentence, maximum 160 characters.",
        },
        needsTaskExtraction: {
          type: "boolean",
          description:
            "True only when the email likely contains a concrete follow-up task worth extracting.",
        },
        needsEventExtraction: {
          type: "boolean",
          description:
            "True only when the email likely contains a specific date/time event worth extracting.",
        },
      },
      required: [
        "category",
        "confidence",
        "summary",
        "needsTaskExtraction",
        "needsEventExtraction",
      ],
      additionalProperties: false,
    },
  };
}

function buildExtractionTool(
  kanbanTargets: CompactKanbanTarget[],
): Anthropic.Tool {
  const taskProperties: Record<string, unknown> = {
    title: { type: "string" },
    description: { type: "string" },
    priority: { type: "string", enum: PRIORITIES },
    dueDate: {
      type: "string",
      description: "ISO 8601 due date if clearly mentioned, otherwise omit.",
    },
  };
  const taskRequired = ["title", "priority"];

  if (kanbanTargets.length > 0) {
    taskProperties.kanbanTargetKey = {
      type: "string",
      enum: kanbanTargets.map((target) => target.key),
      description:
        "Best matching kanban target key from the provided target list.",
    };
    taskRequired.push("kanbanTargetKey");
  }

  return {
    name: "extract_triage_details",
    description:
      "Return all extracted tasks and events for this email in a single response.",
    input_schema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: taskProperties,
            required: taskRequired,
            additionalProperties: false,
          },
        },
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              date: {
                type: "string",
                description: "ISO 8601 event start date/time.",
              },
              place: { type: "string" },
            },
            required: ["title", "date"],
            additionalProperties: false,
          },
        },
      },
      required: ["tasks", "events"],
      additionalProperties: false,
    },
  };
}

async function runClassification(
  model: string,
  email: TriageEmailContext,
  body: { text: string; html: string },
): Promise<ClassificationResult | null> {
  const system =
    "You are an email triage classifier. Classify one email, write one short summary sentence no longer than 160 characters, and decide whether separate task extraction and event extraction are needed. Be conservative with both extraction flags. Use purchases for receipts, invoices, payment notices, or order confirmations that do not need follow-up.";

  const bodySnippet =
    normalizeBodyForTriage(body.text, body.html, "classification") ||
    "(no usable body content)";
  const prompt = `Subject: ${email.subject}
From: ${formatFrom(email.from)}
Date: ${email.date.toISOString()}

Body:
${bodySnippet}`;

  const response = await anthropic.messages.create({
    model: model as Anthropic.Model,
    max_tokens: 220,
    temperature: 0,
    system,
    tools: [buildClassificationTool()],
    tool_choice: {
      type: "tool",
      name: "classify_email",
      disable_parallel_tool_use: true,
    },
    messages: [{ role: "user", content: prompt }],
  });

  const input = getToolInput(response.content, "classify_email");
  if (!input) {
    return null;
  }

  const result: ClassificationResult = {
    category: coerceCategory(input.category),
    confidence: clampConfidence(input.confidence),
    summary: normalizeSummary(
      input.summary,
      email.subject || "Email triage summary unavailable.",
    ),
    needsTaskExtraction: getBoolean(input.needsTaskExtraction),
    needsEventExtraction:
      getBoolean(input.needsEventExtraction) || input.category === "scheduled",
  };

  const cost = calculateCost(
    model,
    response.usage.input_tokens,
    response.usage.output_tokens,
  );
  logLlmUsage({
    llmModel: model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    costUsd: cost,
    systemPrompt: system,
    userPrompt: prompt.slice(0, 3000),
    source: "email-triage-classify",
  });

  return result;
}

async function runExtraction(
  model: string,
  email: TriageEmailContext,
  body: { text: string; html: string },
  classification: ClassificationResult,
  kanbanTargets: CompactKanbanTarget[],
): Promise<ExtractionResult | null> {
  const system =
    "You extract actionable follow-up tasks and calendar events from one email. Do not classify the email. Do not summarize the email. Return a single structured response. Keep tasks empty when no real follow-up is needed. Keep events empty when no specific date/time event is present.";

  const bodySnippet =
    normalizeBodyForTriage(body.text, body.html, "extraction") ||
    "(no usable body content)";
  const sections = [
    `Subject: ${email.subject}`,
    `From: ${formatFrom(email.from)}`,
    `Date: ${email.date.toISOString()}`,
    `Category: ${classification.category}`,
    `Task extraction requested: ${classification.needsTaskExtraction ? "yes" : "no"}`,
    `Event extraction requested: ${classification.needsEventExtraction ? "yes" : "no"}`,
  ];

  if (classification.needsTaskExtraction) {
    sections.push(
      "",
      "Available Kanban Targets:",
      formatKanbanTargets(kanbanTargets),
    );
  }

  sections.push("", "Body:", bodySnippet);

  const prompt = sections.join("\n");

  const response = await anthropic.messages.create({
    model: model as Anthropic.Model,
    max_tokens: 1200,
    temperature: 0,
    system,
    tools: [buildExtractionTool(kanbanTargets)],
    tool_choice: {
      type: "tool",
      name: "extract_triage_details",
      disable_parallel_tool_use: true,
    },
    messages: [{ role: "user", content: prompt }],
  });

  const input = getToolInput(response.content, "extract_triage_details");
  if (!input) {
    return null;
  }

  const tasks: ExtractionResult["tasks"] = [];
  if (classification.needsTaskExtraction && Array.isArray(input.tasks)) {
    for (const task of input.tasks) {
      if (!isRecord(task)) {
        continue;
      }

      const kanbanTarget =
        resolveTaskKanbanTarget(task.kanbanTargetKey, kanbanTargets) ?? {};
      tasks.push({
        title: String(task.title ?? "Untitled"),
        description:
          typeof task.description === "string" ? task.description : undefined,
        priority: coercePriority(task.priority),
        dueDate: parseDate(task.dueDate),
        ...kanbanTarget,
      });
    }
  }

  const events: ExtractionResult["events"] = [];
  if (classification.needsEventExtraction && Array.isArray(input.events)) {
    for (const event of input.events) {
      if (!isRecord(event)) {
        continue;
      }

      const date = parseDate(event.date);
      if (!date) {
        continue;
      }

      events.push({
        title: String(event.title ?? "Untitled"),
        date,
        ...(typeof event.place === "string" ? { place: event.place } : {}),
      });
    }
  }

  const cost = calculateCost(
    model,
    response.usage.input_tokens,
    response.usage.output_tokens,
  );
  logLlmUsage({
    llmModel: model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    costUsd: cost,
    systemPrompt: system,
    userPrompt: prompt.slice(0, 4000),
    source: "email-triage-extract",
  });

  return { tasks, events };
}

async function autoAccept(
  triageId: mongoose.Types.ObjectId,
  result: FullTriageResult,
  routing: ICategoryRouting,
): Promise<{ tasks: number; events: number }> {
  const confOk = result.confidence >= routing.autoAcceptThreshold;
  let taskCount = 0;

  if (routing.autoCreateCard && confOk) {
    for (let index = 0; index < result.tasks.length; index++) {
      const task = result.tasks[index];
      if (!task.kanbanBoardId || !task.kanbanColumnId) {
        continue;
      }

      try {
        const card = await createCard(task.kanbanBoardId, task.kanbanColumnId, {
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate: task.dueDate ? task.dueDate.toISOString() : undefined,
        });
        await EmailTriageModel.updateOne(
          { _id: triageId },
          {
            $set: {
              [`suggestedTasks.${index}.status`]: "accepted",
              [`suggestedTasks.${index}.acceptedCardId`]: card._id,
            },
          },
        );
        taskCount++;
      } catch (err) {
        console.error("auto-accept task failed:", err);
      }
    }
  }

  return { tasks: taskCount, events: 0 };
}

export async function runTriage(options?: {
  since?: Date;
}): Promise<TriageRunStats> {
  await connectDB();
  const settings = await getOrCreateTriageSettings();
  const categoryRouting = normalizeCategoryRouting(settings.categoryRouting);

  if (!settings.enabled) {
    return {
      scanned: 0,
      prefilteredSpam: 0,
      fullTriaged: 0,
      autoAcceptedTasks: 0,
      autoAcceptedEvents: 0,
      errors: 0,
    };
  }

  const isManualRun = options?.since !== undefined;
  if (!isManualRun && settings.lastRunAt) {
    const nextRunAt = new Date(
      settings.lastRunAt.getTime() + settings.runIntervalMinutes * 60 * 1000,
    );
    if (nextRunAt > new Date()) {
      console.log(
        "Skipping triage run — next run scheduled at",
        nextRunAt.toISOString(),
      );
      return {
        scanned: 0,
        prefilteredSpam: 0,
        fullTriaged: 0,
        autoAcceptedTasks: 0,
        autoAcceptedEvents: 0,
        errors: 0,
      };
    }
  }

  console.log("Starting triage run with settings:", options);

  const since =
    options?.since ??
    settings.lastRunAt ??
    new Date(Date.now() - 24 * 60 * 60 * 1000);

  const alreadyTriaged = await EmailTriageModel.find({
    triagedAt: { $gte: since },
  })
    .select("emailId")
    .lean();
  const alreadyIds = new Set(
    alreadyTriaged.map((triage) => triage.emailId.toString()),
  );

  const emails = await EmailModel.find({
    $or: [
      { createdAt: { $gte: since } },
      { createdAt: { $exists: false }, date: { $gte: since } },
    ],
  })
    .sort({ date: 1 })
    .lean();

  const candidates = emails.filter(
    (email) => !alreadyIds.has(email._id.toString()),
  );

  console.log(candidates.length, "emails found since", since.toISOString());

  const stats: TriageRunStats = {
    scanned: candidates.length,
    prefilteredSpam: 0,
    fullTriaged: 0,
    autoAcceptedTasks: 0,
    autoAcceptedEvents: 0,
    errors: 0,
  };

  if (candidates.length === 0) {
    await updateLastRunAt(settings);
    return stats;
  }

  const shortcutMatches = new Map<string, ShortcutRule>();
  const llmCandidates: typeof candidates = [];

  for (const email of candidates) {
    const shortcut = findTriageShortcut(
      email.from.map((entry) => entry.address),
    );
    if (shortcut) {
      shortcutMatches.set(email._id.toString(), shortcut);
    } else {
      llmCandidates.push(email);
    }
  }

  for (const email of candidates) {
    const shortcut = shortcutMatches.get(email._id.toString());
    if (!shortcut) {
      continue;
    }

    try {
      await EmailTriageModel.create({
        emailId: email._id,
        accountId: email.accountId,
        stage: "full",
        category: shortcut.category,
        confidence: shortcut.confidence,
        summary: normalizeSummary(
          email.subject,
          "Informational system update.",
        ),
        suggestedTasks: [],
        suggestedEvents: [],
        modelUsed: `shortcut:${shortcut.pattern}`,
        triagedAt: new Date(),
      });
      stats.fullTriaged++;
    } catch (err) {
      console.error("shortcut triage failed:", err);
      stats.errors++;
    }
  }

  if (llmCandidates.length === 0) {
    await updateLastRunAt(settings);
    return stats;
  }

  const spamIds = new Set(
    await runPrefilter(
      settings.prefilterModel,
      llmCandidates.map((email) => ({
        _id: email._id.toString(),
        subject: email.subject,
        from: email.from,
      })),
    ),
  );

  for (const email of llmCandidates) {
    if (!spamIds.has(email._id.toString())) {
      continue;
    }

    try {
      await EmailTriageModel.create({
        emailId: email._id,
        accountId: email.accountId,
        stage: "prefilter",
        category: "spam",
        confidence: 0.9,
        modelUsed: settings.prefilterModel,
        triagedAt: new Date(),
      });
      stats.prefilteredSpam++;
    } catch (err) {
      console.error("prefilter insert failed:", err);
      stats.errors++;
    }
  }

  let kanbanTargetsCache: CompactKanbanTarget[] | undefined;

  for (const email of llmCandidates) {
    if (spamIds.has(email._id.toString())) {
      continue;
    }

    try {
      const body = await fetchEmailBody(String(email.accountId), email.uid);
      if (!body) {
        stats.errors++;
        continue;
      }

      const emailContext: TriageEmailContext = {
        subject: email.subject,
        from: email.from,
        date: email.date,
      };

      const classification = await runClassification(
        settings.fullModel,
        emailContext,
        {
          text: body.text,
          html: body.html,
        },
      );
      if (!classification) {
        stats.errors++;
        continue;
      }

      let fullResult: FullTriageResult = {
        ...classification,
        tasks: [],
        events: [],
      };

      if (
        classification.needsTaskExtraction ||
        classification.needsEventExtraction
      ) {
        let kanbanTargets: CompactKanbanTarget[] = [];
        if (classification.needsTaskExtraction) {
          if (!kanbanTargetsCache) {
            kanbanTargetsCache = await getKanbanTargets();
          }
          kanbanTargets = kanbanTargetsCache;
        }

        const extraction = await runExtraction(
          settings.fullModel,
          emailContext,
          { text: body.text, html: body.html },
          classification,
          kanbanTargets,
        );
        if (!extraction) {
          stats.errors++;
          continue;
        }

        fullResult = {
          ...classification,
          ...extraction,
        };
      }

      const doc = await EmailTriageModel.create({
        emailId: email._id,
        accountId: email.accountId,
        stage: "full",
        category: fullResult.category,
        confidence: fullResult.confidence,
        summary: fullResult.summary,
        suggestedTasks: fullResult.tasks.map((task) => ({
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate: task.dueDate,
          kanbanBoardId: task.kanbanBoardId,
          kanbanBoardTitle: task.kanbanBoardTitle,
          kanbanColumnId: task.kanbanColumnId,
          kanbanColumnTitle: task.kanbanColumnTitle,
          status: "pending",
        })),
        suggestedEvents: fullResult.events.map((event) => ({
          title: event.title,
          date: event.date,
          place: event.place,
          status: "pending",
        })),
        modelUsed: settings.fullModel,
        triagedAt: new Date(),
      });
      stats.fullTriaged++;

      const accepted = await autoAccept(
        doc._id,
        fullResult,
        categoryRouting[fullResult.category],
      );
      stats.autoAcceptedTasks += accepted.tasks;
      stats.autoAcceptedEvents += accepted.events;
    } catch (err) {
      console.error("full triage failed for", email._id, err);
      stats.errors++;
    }
  }

  await updateLastRunAt(settings);
  return stats;
}

async function updateLastRunAt(
  settings: mongoose.HydratedDocument<ITriageSettings>,
): Promise<void> {
  settings.lastRunAt = new Date();
  await settings.save();
}

export async function acceptSuggestion(
  triageId: string,
  suggestionId: string,
  type: "task" | "event",
  overrides?: Record<string, unknown>,
): Promise<{ ok: true; acceptedId: string } | { ok: false; error: string }> {
  await connectDB();
  const triage = await EmailTriageModel.findById(triageId);
  if (!triage) {
    return { ok: false, error: "Triage not found" };
  }

  if (type === "task") {
    const index = triage.suggestedTasks.findIndex(
      (task) => task._id.toString() === suggestionId,
    );
    if (index < 0) {
      return { ok: false, error: "Suggestion not found" };
    }

    const task = triage.suggestedTasks[index];
    const boardId =
      getStringOverride(overrides, "boardId") ?? task.kanbanBoardId?.toString();
    const columnId =
      getStringOverride(overrides, "columnId") ??
      task.kanbanColumnId?.toString();
    if (!boardId || !columnId) {
      return { ok: false, error: "No kanban target found on this suggestion" };
    }

    const card = await createCard(boardId, columnId, {
      title: getStringOverride(overrides, "title") ?? task.title,
      description:
        getStringOverride(overrides, "description") ?? task.description,
      priority: (getStringOverride(overrides, "priority") ?? task.priority) as
        | KanbanPriority
        | undefined,
      dueDate:
        getStringOverride(overrides, "dueDate") ??
        (task.dueDate ? task.dueDate.toISOString() : undefined),
    });
    triage.suggestedTasks[index].status = "accepted";
    triage.suggestedTasks[index].acceptedCardId = new mongoose.Types.ObjectId(
      card._id,
    );
    await triage.save();
    return { ok: true, acceptedId: card._id.toString() };
  }

  const index = triage.suggestedEvents.findIndex(
    (event) => event._id.toString() === suggestionId,
  );
  if (index < 0) {
    return { ok: false, error: "Suggestion not found" };
  }

  const event = triage.suggestedEvents[index];
  const created = await createCalendarEvent({
    title: getStringOverride(overrides, "title") ?? event.title,
    date: getDateOverride(overrides, "date") ?? event.date,
    place: getStringOverride(overrides, "place") ?? event.place,
    status: "scheduled",
  });
  if (!created) {
    return { ok: false, error: "Failed to create event" };
  }

  triage.suggestedEvents[index].status = "accepted";
  triage.suggestedEvents[index].acceptedEventId = new mongoose.Types.ObjectId(
    created._id,
  );
  await triage.save();
  return { ok: true, acceptedId: created._id.toString() };
}

export async function dismissSuggestion(
  triageId: string,
  suggestionId: string,
  type: "task" | "event",
): Promise<{ ok: boolean }> {
  await connectDB();
  const key = type === "task" ? "suggestedTasks" : "suggestedEvents";
  const result = await EmailTriageModel.updateOne(
    {
      _id: triageId,
      [`${key}._id`]: new mongoose.Types.ObjectId(suggestionId),
    },
    { $set: { [`${key}.$.status`]: "dismissed" } },
  );

  return { ok: result.modifiedCount > 0 };
}
