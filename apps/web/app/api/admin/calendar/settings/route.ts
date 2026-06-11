import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { CalendarSettings } from "@/models/CalendarSettings";

function serializeSettings(settings: {
  _id: string;
  holidayCountryCode?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    _id: "singleton",
    holidayCountryCode: settings.holidayCountryCode ?? null,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();
  const settings = await CalendarSettings.findByIdAndUpdate(
    "singleton",
    { $setOnInsert: { holidayCountryCode: null } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
    .lean()
    .exec();

  return NextResponse.json({ settings: serializeSettings(settings) });
}

export async function PATCH(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const holidayCountryCode =
    typeof body.holidayCountryCode === "string" &&
    body.holidayCountryCode.trim()
      ? body.holidayCountryCode.trim().toUpperCase()
      : null;

  await connectDB();
  const settings = await CalendarSettings.findByIdAndUpdate(
    "singleton",
    { holidayCountryCode },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
    .lean()
    .exec();

  return NextResponse.json({ settings: serializeSettings(settings) });
}
