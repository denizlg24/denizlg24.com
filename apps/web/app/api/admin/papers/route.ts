import { createPaperSchema, type PaperCourseRef } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { pruneGroupIds, serializeGroup } from "@/lib/note-route-utils";
import { serializePaper } from "@/lib/paper-citations";
import {
  createPaperWithLinkedNote,
  noteGroupIdsByPaper,
} from "@/lib/paper-notes";
import { isDuplicatePaperError } from "@/lib/paper-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { Course } from "@/models/Course";
import { Note } from "@/models/Note";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";
import { type ILeanPaper, Paper } from "@/models/Paper";

type LeanCourseRef = Omit<PaperCourseRef, "_id"> & { _id: unknown };

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const courseId = request.nextUrl.searchParams.get("courseId");
  if (courseId && !mongoose.Types.ObjectId.isValid(courseId)) {
    return NextResponse.json({ error: "Invalid courseId" }, { status: 400 });
  }
  const filter = courseId
    ? { courseIds: new mongoose.Types.ObjectId(courseId) }
    : {};

  try {
    await connectDB();
    const [papers, notes, courses, groups] = await Promise.all([
      Paper.find(filter).sort({ updatedAt: -1 }).lean<ILeanPaper[]>().exec(),
      Note.find()
        .select("_id title url")
        .sort({ updatedAt: -1 })
        .lean<Array<{ _id: unknown; title: string; url?: string }>>()
        .exec(),
      Course.find()
        .select("_id name code color status")
        .sort({ name: 1 })
        .lean<LeanCourseRef[]>()
        .exec(),
      NoteGroup.find().sort({ name: 1 }).lean<ILeanNoteGroup[]>().exec(),
    ]);
    const noteGroupIds = await noteGroupIdsByPaper(
      papers.map((paper) => paper._id),
    );
    return NextResponse.json({
      papers: papers.map((paper) => ({
        ...serializePaper(paper),
        noteGroupIds: noteGroupIds.get(String(paper._id)) ?? [],
      })),
      notes: notes.map((note) => ({ ...note, _id: String(note._id) })),
      courses: courses.map(
        (course): PaperCourseRef => ({ ...course, _id: String(course._id) }),
      ),
      groups: groups.map(serializeGroup),
    });
  } catch (error) {
    console.error("Failed to load papers:", error);
    return NextResponse.json(
      { error: "Failed to load papers" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const parsed = createPaperSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid paper", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await connectDB();
    const groupIds = await pruneGroupIds(parsed.data.noteGroupIds ?? []);
    const { paper } = await createPaperWithLinkedNote(parsed.data, {
      note: { groupIds },
    });
    return NextResponse.json(
      {
        paper: {
          ...serializePaper(paper),
          noteGroupIds: groupIds.map(String),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (isDuplicatePaperError(error)) {
      return NextResponse.json(
        {
          error:
            "A paper with this DOI, arXiv id, or citation key already exists",
        },
        { status: 409 },
      );
    }
    if (error instanceof Error && /^Invalid /.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to create paper:", error);
    return NextResponse.json(
      { error: "Failed to create paper" },
      { status: 500 },
    );
  }
}
