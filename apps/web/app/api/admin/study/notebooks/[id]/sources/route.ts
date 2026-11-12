import { notebookSourcesPatchSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, type StudyParams, studyRoute } from "@/lib/study/http";
import { patchNotebookSources } from "@/lib/study/notebooks";

export function PATCH(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    const patch = await readBody(request, notebookSourcesPatchSchema);
    return NextResponse.json(await patchNotebookSources(id, patch));
  });
}
