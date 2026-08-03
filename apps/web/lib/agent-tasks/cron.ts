import { Cron } from "croner";

export class InvalidCronExpressionError extends Error {
  constructor(expression: string, cause: unknown) {
    super(
      `Invalid cron expression "${expression}": ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "InvalidCronExpressionError";
  }
}

/**
 * Croner is happy to build a pattern that can never match — 31 February, say —
 * and simply returns null forever after. A schedule that silently never fires
 * is worse than a rejected one, so the absence of a next occurrence is treated
 * as a validation failure at write time rather than a surprise at run time.
 */
export function nextCronOccurrence(options: {
  cron: string;
  timeZone: string;
  after?: Date;
}): Date {
  const after = options.after ?? new Date();
  let cron: Cron;
  try {
    cron = new Cron(options.cron, {
      timezone: options.timeZone,
      paused: true,
    });
  } catch (error) {
    throw new InvalidCronExpressionError(options.cron, error);
  }
  const next = cron.nextRun(after);
  if (!next) {
    throw new InvalidCronExpressionError(
      options.cron,
      new Error("expression has no future occurrence"),
    );
  }
  return next;
}

export function assertValidCron(cron: string, timeZone: string) {
  nextCronOccurrence({ cron, timeZone });
}

/** The next few firings, so the editor can show what a pattern actually means. */
export function previewCronOccurrences(options: {
  cron: string;
  timeZone: string;
  count?: number;
  after?: Date;
}): Date[] {
  const count = Math.min(options.count ?? 3, 10);
  const occurrences: Date[] = [];
  let cursor = options.after ?? new Date();
  for (let index = 0; index < count; index++) {
    cursor = nextCronOccurrence({
      cron: options.cron,
      timeZone: options.timeZone,
      after: cursor,
    });
    occurrences.push(cursor);
  }
  return occurrences;
}
