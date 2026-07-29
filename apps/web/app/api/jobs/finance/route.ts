import { NextResponse } from "next/server";
import { runFinanceCron } from "@/lib/finance/sync";
import { isAuthorizedJobRequest } from "@/lib/job-authorization";

export const maxDuration = 300;

async function run(request: Request) {
  if (!isAuthorizedJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runFinanceCron());
  } catch (error) {
    console.error("[finance] Cron failed", error);
    return NextResponse.json({ error: "Finance cron failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
