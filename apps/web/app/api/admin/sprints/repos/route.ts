import { type NextRequest, NextResponse } from "next/server";
import { withSprints } from "@/lib/sprints/http";
import { listSprintRepos } from "@/lib/sprints/service";

export async function GET(request: NextRequest) {
  return withSprints(request, async () =>
    NextResponse.json({ repos: await listSprintRepos() }),
  );
}
