import { knowledgeSourceKey } from "@repo/schemas";
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
import { deleteFileFromStorage, uploadFileToStorage } from "@/lib/storage-api";
import { patchNotebookSources } from "@/lib/study/notebooks";
import { Notebook } from "@/models/Notebook";
import { type ILeanStudyDocument, StudyDocument } from "@/models/StudyDocument";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const PDF_MAGIC = "%PDF-";

function formString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formObjectId(value: FormDataEntryValue | null): string | undefined {
  const text = formString(value);
  return text && mongoose.Types.ObjectId.isValid(text) ? text : undefined;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    const courseId = request.nextUrl.searchParams.get("courseId");
    const documents = await StudyDocument.find(
      courseId && mongoose.Types.ObjectId.isValid(courseId)
        ? { courseId: new mongoose.Types.ObjectId(courseId) }
        : {},
    )
      .sort({ createdAt: -1 })
      .lean<ILeanStudyDocument[]>()
      .exec();
    return NextResponse.json(
      { documents: documents.map(serializeStudyDocument) },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to list study documents:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  let storageKey: string | undefined;
  let createdId: string | undefined;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: `PDF must be between 1 byte and ${MAX_PDF_BYTES} bytes` },
        { status: 413 },
      );
    }
    const header = await file.slice(0, PDF_MAGIC.length).text();
    if (header !== PDF_MAGIC) {
      return NextResponse.json({ error: "File is not a PDF" }, { status: 415 });
    }
    const courseId = formObjectId(form.get("courseId"));
    const notebookId = formObjectId(form.get("notebookId"));

    await connectDB();
    if (notebookId && !(await Notebook.exists({ _id: notebookId }))) {
      return NextResponse.json(
        { error: "Notebook not found" },
        { status: 404 },
      );
    }

    const uploaded = await uploadFileToStorage(file, "file");
    storageKey = uploaded.id;
    const fileName = file.name || "document.pdf";
    const created = await StudyDocument.create({
      title: formString(form.get("title")) ?? fileName.replace(/\.pdf$/i, ""),
      fileName,
      fileUrl: uploaded.publicUrl,
      storageKey: uploaded.id,
      size: file.size,
      extraction: "pending",
      ...(courseId ? { courseId } : {}),
    });
    createdId = String(created._id);
    if (notebookId) {
      await patchNotebookSources(notebookId, {
        add: [{ kind: "document", id: String(created._id) }],
      });
    }
    await enqueueKnowledgeReindex([
      knowledgeSourceKey("document", String(created._id)),
    ]);
    return NextResponse.json(
      { document: serializeStudyDocument(created.toObject()) },
      { status: 201 },
    );
  } catch (error) {
    if (createdId) {
      const id = createdId;
      await Promise.all([
        StudyDocument.deleteOne({ _id: id }),
        deleteExtraction(id),
        deleteKnowledgeSource(knowledgeSourceKey("document", id)),
      ]).catch(() => undefined);
    }
    if (storageKey) {
      await deleteFileFromStorage(storageKey).catch(() => undefined);
    }
    console.error("Failed to upload study document:", error);
    return NextResponse.json(
      { error: "Failed to upload document" },
      { status: 500 },
    );
  }
}
