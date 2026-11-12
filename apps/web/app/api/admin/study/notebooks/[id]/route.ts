import { notebookUpdateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, type StudyParams, studyRoute } from "@/lib/study/http";
import {
  deleteNotebook,
  getNotebookDetail,
  updateNotebook,
} from "@/lib/study/notebooks";

export function GET(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    return NextResponse.json(await getNotebookDetail(id));
  });
}

export function PATCH(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    const input = await readBody(request, notebookUpdateSchema);
    return NextResponse.json({ notebook: await updateNotebook(id, input) });
  });
}

export function DELETE(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    await deleteNotebook(id);
    return NextResponse.json({ deleted: true });
  });
}
