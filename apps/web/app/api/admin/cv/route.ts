import {
  type ICvFile,
  type ILatexProject,
  latexProjectSchema,
} from "@repo/schemas";
import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";
import { deleteFileFromStorage, uploadFileToStorage } from "@/lib/storage-api";
import {
  AppSettings,
  type ILeanAppSettings,
  type IStoredCv,
} from "@/models/AppSettings";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function serializeCv(cv: IStoredCv | null | undefined): ICvFile | null {
  if (!cv) return null;
  return {
    url: cv.url,
    filename: cv.filename,
    size: cv.size,
    updatedAt: new Date(cv.updatedAt).toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    const settings = await AppSettings.findById("singleton")
      .lean<ILeanAppSettings>()
      .exec();
    return NextResponse.json({
      cv: serializeCv(settings?.cv),
      draft: serializeCv(settings?.cvDraft),
      project: settings?.cvProject ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Project exceeds 4MB" }, { status: 413 });
  }

  let project: ILatexProject;
  try {
    project = latexProjectSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid LaTeX project" },
      { status: 400 },
    );
  }

  try {
    await connectDB();
    const settings = await AppSettings.findByIdAndUpdate(
      "singleton",
      { $set: { cvProject: project } },
      { upsert: true, new: true },
    )
      .lean<ILeanAppSettings>()
      .exec();
    return NextResponse.json({
      cv: serializeCv(settings?.cv),
      draft: serializeCv(settings?.cvDraft),
      project,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to save CV source" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const data = await request.formData();
    const entry = data.get("file");

    if (!(entry instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const file = entry;

    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json(
        { error: "Only PDF files are allowed" },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` },
        { status: 413 },
      );
    }

    const uploaded = await uploadFileToStorage(file, "file");

    let settings: ILeanAppSettings | null;
    try {
      await connectDB();
      settings = await AppSettings.findByIdAndUpdate(
        "singleton",
        {
          $set: {
            cv: {
              url: uploaded.publicUrl,
              filename: file.name,
              size: uploaded.sizeBytes,
              updatedAt: new Date(),
            },
          },
        },
        { upsert: true, new: true },
      )
        .lean<ILeanAppSettings>()
        .exec();
    } catch (dbError) {
      // Persisting the metadata failed — remove the just-uploaded file so we
      // don't leave an orphaned object in storage.
      await deleteFileFromStorage(uploaded.id).catch((cleanupError) => {
        console.error(
          "Failed to clean up orphaned CV upload after DB error:",
          cleanupError,
        );
      });
      throw dbError;
    }

    const cv = serializeCv(settings?.cv);
    if (!cv) {
      // Mongoose strict mode silently strips paths the registered schema doesn't
      // know about — happens when a running server predates the cv field.
      console.error(
        "CV upload stored the file but the metadata write was dropped — restart the server so the AppSettings schema includes `cv`.",
      );
      return NextResponse.json(
        {
          error:
            "File uploaded but CV metadata failed to persist. Restart the server and try again.",
        },
        { status: 500 },
      );
    }

    revalidatePath("/");

    return NextResponse.json({
      cv,
      draft: serializeCv(settings?.cvDraft),
      project: settings?.cvProject ?? null,
    });
  } catch (error) {
    const err = error as Error;
    console.error("Error uploading CV:", err);
    return NextResponse.json({ error: "Failed to upload CV" }, { status: 500 });
  }
}
