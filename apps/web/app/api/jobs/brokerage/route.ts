import { NextResponse } from "next/server";
import { runBrokerageSync } from "@/lib/brokerage/sync";
import { isAuthorizedJobRequest } from "@/lib/job-authorization";

export const maxDuration = 300;

async function run(request: Request) {
  if (!isAuthorizedJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runBrokerageSync());
  } catch (error) {
    console.error("[brokerage] Cron failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Brokerage cron failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
