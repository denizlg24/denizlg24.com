import {
  type MacrosTestFlightSignupResponse,
  macrosTestFlightSignupBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { inviteToTestFlight, TestFlightError } from "@/lib/testflight";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
// Every accepted request makes Apple email an address, so the form must not
// become a way to mail strangers: a few attempts per client per hour.
const attempts = new Map<string, number[]>();

function clientKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function allow(key: string, now: number): boolean {
  const recent = (attempts.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    attempts.set(key, recent);
    return false;
  }
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 10_000) {
    for (const [stale, times] of attempts) {
      if (times.every((at) => now - at >= WINDOW_MS)) attempts.delete(stale);
    }
  }
  return true;
}

export async function POST(request: Request) {
  const parsed = macrosTestFlightSignupBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  }
  // A filled honeypot gets the same answer a person would, and nothing else.
  if (parsed.data.website) {
    return NextResponse.json({
      status: "invited",
    } satisfies MacrosTestFlightSignupResponse);
  }
  if (!allow(clientKey(request), Date.now())) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in an hour." },
      { status: 429 },
    );
  }

  try {
    const result = await inviteToTestFlight(parsed.data);
    return NextResponse.json(result satisfies MacrosTestFlightSignupResponse);
  } catch (error) {
    console.error("[testflight] sign-up failed", error);
    const configured = !(error instanceof TestFlightError) || error.configured;
    return NextResponse.json(
      {
        error: configured
          ? "Couldn’t send the invite right now. Please try again later."
          : "iPhone sign-ups aren’t open yet.",
      },
      { status: configured ? 502 : 503 },
    );
  }
}
