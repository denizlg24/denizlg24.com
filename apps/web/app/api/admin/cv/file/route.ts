import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AppSettings, type ILeanAppSettings } from "@/models/AppSettings";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    const settings = await AppSettings.findById("singleton")
      .lean<ILeanAppSettings>()
      .exec();
    const source = settings?.cvDraft ?? settings?.cv;
    if (!source) {
      return NextResponse.json({ error: "No CV uploaded" }, { status: 404 });
    }

    const upstream = await fetch(source.url, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: "Failed to fetch CV from storage" },
        { status: 502 },
      );
    }

    return new NextResponse(upstream.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${source.filename.replace(/["\r\n]/g, "")}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
