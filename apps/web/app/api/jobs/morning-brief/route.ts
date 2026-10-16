import { NextResponse } from "next/server";
import { isAuthorizedJobRequest } from "@/lib/job-authorization";
import { sendMorningBrief } from "@/lib/morning-brief";

/**
 * The phone's morning brief. Called by the external scheduler at the time
 * the brief should arrive; a second call the same day sends nothing.
 */
async function run(request: Request) {
  if (!isAuthorizedJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await sendMorningBrief());
  } catch (error) {
    console.error("[morning-brief] failed", error);
    return NextResponse.json(
      { error: "Morning brief failed" },
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
