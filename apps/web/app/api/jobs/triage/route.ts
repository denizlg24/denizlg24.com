import { randomUUID, timingSafeEqual } from "node:crypto";
import { runTriage } from "@/lib/triage";
import { withTriageRunLease } from "@/lib/triage-run-lease";

export const maxDuration = 300;

const TRIAGE_LIMIT_PER_RUN = 25;
const TRIAGE_CONCURRENCY = 4;
const TRIAGE_TIME_BUDGET_MS = 4 * 60 * 1_000;

function isAuthorized(request: Request): boolean {
  const token = process.env.TRIAGE_JOB_BEARER_TOKEN?.trim();
  const authorization = request.headers.get("Authorization");
  if (!token || !authorization) return false;

  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(authorization);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const run = await withTriageRunLease(`job-route:${randomUUID()}`, () =>
      runTriage({
        limit: TRIAGE_LIMIT_PER_RUN,
        concurrency: TRIAGE_CONCURRENCY,
        extractionConcurrency: 2,
        fetchBatchSize: TRIAGE_LIMIT_PER_RUN,
        skipUnavailable: true,
        timeBudgetMs: TRIAGE_TIME_BUDGET_MS,
      }),
    );
    if (!run.acquired) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "already-running" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const { result: stats } = run;
    return new Response(JSON.stringify({ stats }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Triage run failed:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Triage run failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
