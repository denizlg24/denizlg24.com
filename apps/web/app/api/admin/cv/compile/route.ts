import {
  type ICvFile,
  type ILatexProject,
  latexProjectSchema,
} from "@repo/schemas";
import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import {
  compileLatexProject,
  LatexCompilationError,
} from "@/lib/latex-compiler";
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
export const maxDuration = 120;

let compilationInFlight = false;

function serializeCv(cv: IStoredCv): ICvFile {
  return {
    url: cv.url,
    filename: cv.filename,
    size: cv.size,
    updatedAt: new Date(cv.updatedAt).toISOString(),
  };
}

export async function POST(request: NextRequest) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;

  if (compilationInFlight) {
    return NextResponse.json(
      { error: "A compilation is already running" },
      { status: 409 },
    );
  }
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

  compilationInFlight = true;
  try {
    await connectDB();
    const previous = await AppSettings.findById("singleton")
      .lean<ILeanAppSettings>()
      .exec();

    await AppSettings.findByIdAndUpdate(
      "singleton",
      { $set: { cvProject: project } },
      { upsert: true },
    ).exec();

    let compilation: Awaited<ReturnType<typeof compileLatexProject>>;
    try {
      compilation = await compileLatexProject(project);
    } catch (error) {
      if (error instanceof LatexCompilationError) {
        return NextResponse.json(
          { error: error.message, log: error.log },
          { status: 422 },
        );
      }
      throw error;
    }

    const filename = "DenizGunesCV.pdf";
    const file = new File([new Uint8Array(compilation.pdf)], filename, {
      type: "application/pdf",
    });
    const uploaded = await uploadFileToStorage(file, "file");

    let settings: ILeanAppSettings | null;
    try {
      settings = await AppSettings.findByIdAndUpdate(
        "singleton",
        {
          $set: {
            cvProject: project,
            cv: {
              url: uploaded.publicUrl,
              filename,
              size: uploaded.sizeBytes,
              storageKey: uploaded.id,
              updatedAt: new Date(),
            },
          },
        },
        { upsert: true, new: true },
      )
        .lean<ILeanAppSettings>()
        .exec();
    } catch (error) {
      await deleteFileFromStorage(uploaded.id).catch(() => undefined);
      throw error;
    }

    if (!settings?.cv) {
      await deleteFileFromStorage(uploaded.id).catch(() => undefined);
      throw new Error("CV metadata was not persisted");
    }
    if (previous?.cv?.storageKey && previous.cv.storageKey !== uploaded.id) {
      await deleteFileFromStorage(previous.cv.storageKey).catch((error) => {
        console.error("Failed to remove previous compiled CV", error);
      });
    }

    revalidatePath("/");
    return NextResponse.json({
      cv: serializeCv(settings.cv),
      project,
      log: compilation.log,
    });
  } catch (error) {
    console.error("CV compilation failed", error);
    return NextResponse.json(
      { error: "Failed to compile CV" },
      { status: 500 },
    );
  } finally {
    compilationInFlight = false;
  }
}
