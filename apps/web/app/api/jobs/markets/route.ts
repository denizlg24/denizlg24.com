import { NextResponse } from "next/server";
import { isAuthorizedJobRequest } from "@/lib/job-authorization";
import { runMarketsCron } from "@/lib/markets/cron";

export const maxDuration = 300;

async function run(request: Request) {
  if (!isAuthorizedJobRequest(request)) {
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
