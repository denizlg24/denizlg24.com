import { workspacePrefsInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";

export async function GET(request: NextRequest) {
  return withWorkspace(request, async (service) =>
    NextResponse.json({ prefs: await service.getPrefs() }),
  );
}

export async function PUT(request: NextRequest) {
  return withWorkspace(request, async (service) => {
    const input = await readBody(request, workspacePrefsInputSchema);
    return NextResponse.json({ prefs: await service.putPrefs(input) });
  });
}
