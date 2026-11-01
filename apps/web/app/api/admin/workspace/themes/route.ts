import { themeInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { createTheme, listThemes } from "@/lib/workspace/appearance";
import { readBody, withWorkspace } from "@/lib/workspace/http";

export async function GET(request: NextRequest) {
  return withWorkspace(request, async () =>
    NextResponse.json({ themes: await listThemes() }),
  );
}

export async function POST(request: NextRequest) {
  return withWorkspace(request, async (_service, caller) => {
    const input = await readBody(request, themeInputSchema);
    return NextResponse.json(
      { theme: await createTheme(input, caller.actor) },
      { status: 201 },
    );
  });
}
