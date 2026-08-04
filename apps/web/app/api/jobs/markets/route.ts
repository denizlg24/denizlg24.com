import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isAuthorizedJobRequest } from "@/lib/job-authorization";
import { runMarketsCron } from "@/lib/markets/cron";

export const maxDuration = 300;

/**
 * `MARKETS_JOB_BEARER_TOKEN` was documented from the start but read by nothing,
 * so a scheduler configured with it got 401 on every run and the cache simply
 * never refreshed. It is honoured here rather than in the shared helper: that
 * one gates agent-memory and voice-notes too, and a markets token has no
 * business opening those.
 */
function matchesMarketsToken(request: Request): boolean {
  const token = process.env.MARKETS_JOB_BEARER_TOKEN?.trim();
  const provided = request.headers.get("Authorization");
  if (!token || !provided) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function run(request: Request) {
  if (!isAuthorizedJobRequest(request) && !matchesMarketsToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runMarketsCron());
  } catch (error) {
    console.error("[markets] Cron failed", error);
    return NextResponse.json({ error: "Markets cron failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
