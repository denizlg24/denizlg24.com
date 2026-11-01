import { themeScheduleInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { addScheduleEntry } from "@/lib/workspace/appearance";
import { readBody, withWorkspace } from "@/lib/workspace/http";

export async function POST(request: NextRequest) {
  return withWorkspace(request, async () => {
    const input = await readBody(request, themeScheduleInputSchema);
    return NextResponse.json(
      { appearance: await addScheduleEntry(input) },
      { status: 201 },
    );
  });
}
