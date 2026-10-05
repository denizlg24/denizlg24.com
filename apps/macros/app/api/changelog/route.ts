import type { ChangelogResponse } from "@repo/schemas";
import { NextResponse } from "next/server";
import { loadChangelog } from "@/lib/changelog/load";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({
    releases: await loadChangelog(),
  } satisfies ChangelogResponse);
}
