import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import {
  getAppTimeZone,
  isValidTimeZone,
  setAppTimeZone,
} from "@/lib/timezone";
import { AppSettings, type ILeanAppSettings } from "@/models/AppSettings";

async function buildSettingsResponse() {
  const settings = await AppSettings.findById("singleton")
    .lean<ILeanAppSettings>()
    .exec();
  return {
    settings: {
      timeZone: settings?.timeZone ?? null,
      effectiveTimeZone: await getAppTimeZone(),
    },
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    return NextResponse.json(await buildSettingsResponse());
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!("timeZone" in body)) {
      return NextResponse.json(
        { error: "timeZone is required" },
        { status: 400 },
      );
    }

    const timeZone = body.timeZone;
    if (timeZone !== null) {
      if (typeof timeZone !== "string" || !isValidTimeZone(timeZone)) {
        return NextResponse.json(
          { error: "timeZone must be a valid IANA timezone or null" },
          { status: 400 },
        );
      }
    }

    await setAppTimeZone(timeZone);
    return NextResponse.json(await buildSettingsResponse());
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
