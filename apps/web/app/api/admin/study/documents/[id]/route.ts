import { knowledgeSourceKey, studyDocumentUpdateSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { deleteExtraction } from "@/lib/knowledge/extraction-store";
import {
  deleteKnowledgeSource,
  enqueueKnowledgeReindex,
} from "@/lib/knowledge/reindex";
import { serializeStudyDocument } from "@/lib/knowledge/serialize";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { deleteFileFromStorage } from "@/lib/storage-api";
import { Notebook } from "@/models/Notebook";
import { type ILeanStudyDocument, StudyDocument } from "@/models/StudyDocument";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await connectDB();
    const document = await StudyDocument.findById(id)
      .lean<ILeanStudyDocument>()
      .exec();
    if (!document) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(
      { document: serializeStudyDocument(document) },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to load study document:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const parsed = studyDocumentUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success || !mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  try {
    await connectDB();
    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    if (parsed.data.title !== undefined) set.title = parsed.data.title;
    if (parsed.data.courseId === null) unset.courseId = "";
    else if (parsed.data.courseId) set.courseId = parsed.data.courseId;
    const document = await StudyDocument.findByIdAndUpdate(
      id,
      {
        ...(Object.keys(set).length > 0 ? { $set: set } : {}),
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
      { returnDocument: "after", runValidators: true },
    )
      .lean<ILeanStudyDocument>()
      .exec();
    if (!document) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (parsed.data.title !== undefined) {
      await enqueueKnowledgeReindex([knowledgeSourceKey("document", id)]);
    }
    return NextResponse.json(
      { document: serializeStudyDocument(document) },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to update study document:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await connectDB();
    const document = await StudyDocument.findById(id)
      .lean<ILeanStudyDocument>()
      .exec();
    if (!document) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const key = knowledgeSourceKey("document", id);
    await Promise.all([
      deleteKnowledgeSource(key),
      deleteExtraction(id),
      Notebook.updateMany(
        { $or: [{ "sources.id": document._id }, { excluded: key }] },
        {
          $pull: {
            sources: { kind: "document", id: document._id },
            excluded: key,
          },
        },
      ),
    ]);
    // An orphaned blob is invisible; a row pointing at a missing one is not.
    await deleteFileFromStorage(document.storageKey).catch((error) => {
      console.error("Failed to delete study document file", error);
    });
    await StudyDocument.deleteOne({ _id: document._id });
    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (error) {
    console.error("Failed to delete study document:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
