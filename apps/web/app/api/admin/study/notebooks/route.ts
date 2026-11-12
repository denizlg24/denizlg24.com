import { notebookCreateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, studyRoute } from "@/lib/study/http";
import { createNotebook, listNotebooks } from "@/lib/study/notebooks";

export function GET(request: NextRequest) {
  return studyRoute(request, async () => {
    const archived = request.nextUrl.searchParams.get("archived") === "1";
    const notebooks = await listNotebooks({ archived });
    return NextResponse.json({ notebooks });
  });
}

export function POST(request: NextRequest) {
  return studyRoute(request, async () => {
    const input = await readBody(request, notebookCreateSchema);
    const notebook = await createNotebook(input);
    return NextResponse.json({ notebook }, { status: 201 });
  });
}
