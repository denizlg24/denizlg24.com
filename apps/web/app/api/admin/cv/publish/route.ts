import type { ICvFile } from "@repo/schemas";
import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";
import { deleteFileFromStorage } from "@/lib/storage-api";
import {
  AppSettings,
  type ILeanAppSettings,
  type IStoredCv,
} from "@/models/AppSettings";

export const runtime = "nodejs";
export const maxDuration = 30;

function serializeCv(cv: IStoredCv | null | undefined): ICvFile | null {
  if (!cv) return null;
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

  try {
    await connectDB();
    const previous = await AppSettings.findById("singleton")
      .lean<ILeanAppSettings>()
      .exec();

    const draft = previous?.cvDraft;
    if (!draft) {
      return NextResponse.json(
        { error: "No compiled draft to publish" },
        { status: 409 },
      );
    }

    const settings = await AppSettings.findByIdAndUpdate(
      "singleton",
      {
        $set: {
          cv: {
            url: draft.url,
            filename: draft.filename,
            size: draft.size,
            storageKey: draft.storageKey,
            updatedAt: new Date(),
          },
          cvDraft: null,
        },
      },
      { upsert: true, new: true },
    )
      .lean<ILeanAppSettings>()
      .exec();

    if (!settings?.cv) {
      throw new Error("Published CV metadata was not persisted");
    }
    if (
      previous?.cv?.storageKey &&
      previous.cv.storageKey !== draft.storageKey
    ) {
      await deleteFileFromStorage(previous.cv.storageKey).catch((error) => {
        console.error("Failed to remove previous published CV", error);
      });
    }

    revalidatePath("/");
    return NextResponse.json({
      cv: serializeCv(settings.cv),
      draft: null,
      project: settings.cvProject ?? null,
    });
  } catch (error) {
    console.error("CV publish failed", error);
    return NextResponse.json(
      { error: "Failed to publish CV" },
      { status: 500 },
    );
  }
}
