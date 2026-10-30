import {
  type Block,
  blockSchema,
  type InlineRun,
  isTextBlock,
  type RichText,
  TEMPLATE_INPUT_NAME_MAX,
  type TemplateInputs,
} from "@repo/schemas";
import { normalizeRuns } from "./workspace-rich-text";
import { childrenOf } from "./workspace-tree";

/*
 * Templates: a page whose blocks are copied, with fresh ids and `{{…}}`
 * variables filled in, into a new page or into an existing one.
 *
 * Variables are filled inside text runs (each run on its own, so a variable
 * split across differently marked runs stays literal), mention labels, table
 * cells, image captions and widget titles. Button actions, agent prompts and
 * code are copied verbatim: a button's `{{date}}` means the day it is
 * pressed, not the day the template was used.
 */

export interface TemplateClock {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM`, 24-hour */
  time: string;
  /** ISO week, `YYYY-Www` */
  week: string;
  /** English weekday name */
  weekday: string;
}

export interface TemplateContext extends TemplateClock {
  pageTitle: string;
  inputs: TemplateInputs;
}

const VARIABLE =
  /\{\{\s*(date|time|week|weekday|page\.title|input:([^{}]+?))\s*\}\}/g;
const INPUT = /\{\{\s*input:([^{}]+?)\s*\}\}/g;

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** ISO 8601 week of a calendar date: the week holding its Thursday. */
export function isoWeek(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The clock variables at `now` in `timeZone`. */
export function templateClock(now: Date, timeZone: string): TemplateClock {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  }).formatToParts(now);
  const date = `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
  return {
    date,
    time: `${part(parts, "hour")}:${part(parts, "minute")}`,
    week: isoWeek(date),
    weekday: part(parts, "weekday"),
  };
}

/** `text` with every known variable filled; an unknown `{{…}}` stays as written. */
export function fillTemplate(text: string, context: TemplateContext): string {
  return text.replace(VARIABLE, (whole, name: string, input?: string) => {
    if (input !== undefined) return context.inputs[input.trim()] ?? "";
    switch (name) {
      case "date":
        return context.date;
      case "time":
        return context.time;
      case "week":
        return context.week;
      case "weekday":
        return context.weekday;
      case "page.title":
        return context.pageTitle;
      default:
        return whole;
    }
  });
}

function fillRuns(runs: RichText, context: TemplateContext): RichText {
  return normalizeRuns(
    runs.flatMap((run): InlineRun[] => {
      if (run.type === "mention") {
        if (run.label === undefined) return [run];
        const label = fillTemplate(run.label, context);
        if (label) return [{ ...run, label }];
        const { label: _label, ...unlabelled } = run;
        return [unlabelled];
      }
      const text = fillTemplate(run.text, context);
      return text ? [{ ...run, text }] : [];
    }),
  );
}

function runsText(runs: RichText): string[] {
  return runs.map((run) =>
    run.type === "mention" ? (run.label ?? "") : run.text,
  );
}

/** Every string a template fills, for finding its inputs. */
function fillableStrings(block: Block): string[] {
  const out: string[] = [];
  if (isTextBlock(block)) out.push(...runsText(block.text));
  if (block.type === "table") {
    for (const row of block.rows)
      for (const cell of row) out.push(...runsText(cell));
  }
  if (block.type === "image") out.push(...runsText(block.caption));
  if ("title" in block && typeof block.title === "string")
    out.push(block.title);
  for (const child of childrenOf(block)) out.push(...fillableStrings(child));
  return out;
}

/** Names of the `{{input:Name}}` prompts in `title` and `blocks`, first seen first. */
export function templateInputNames(
  title: string,
  blocks: readonly Block[],
): string[] {
  const names: string[] = [];
  const texts = [title, ...blocks.flatMap(fillableStrings)];
  for (const text of texts) {
    for (const match of text.matchAll(INPUT)) {
      const name = (match[1] ?? "").trim().slice(0, TEMPLATE_INPUT_NAME_MAX);
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

function fillBlock(
  block: Block,
  context: TemplateContext,
  newId: () => string,
): Block {
  const candidate: Record<string, unknown> = { ...block, id: newId() };
  if (isTextBlock(block)) candidate.text = fillRuns(block.text, context);
  if (block.type === "table") {
    candidate.rows = block.rows.map((row) =>
      row.map((cell) => fillRuns(cell, context)),
    );
  }
  if (block.type === "image") {
    candidate.caption = fillRuns(block.caption, context);
  }
  if ("title" in block && typeof block.title === "string") {
    candidate.title = fillTemplate(block.title, context);
  }
  if ("children" in block) {
    candidate.children = block.children.map((child) =>
      fillBlock(child, context, newId),
    );
  }
  return blockSchema.parse(candidate);
}

/** A template's blocks as they land: fresh ids at every depth, variables filled. */
export function instantiateTemplateBlocks(
  blocks: readonly Block[],
  context: TemplateContext,
  newId: () => string,
): Block[] {
  return blocks.map((block) => fillBlock(block, context, newId));
}

/** `blocks` with fresh ids at every depth and nothing else changed. */
export function withFreshBlockIds(
  blocks: readonly Block[],
  newId: () => string,
): Block[] {
  return blocks.map((block) => {
    const candidate: Record<string, unknown> = { ...block, id: newId() };
    if ("children" in block) {
      candidate.children = withFreshBlockIds(block.children, newId);
    }
    return blockSchema.parse(candidate);
  });
}
