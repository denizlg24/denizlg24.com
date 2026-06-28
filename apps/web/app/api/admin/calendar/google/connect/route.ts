import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { getGoogleCalendarAuthorizationUrl } from "@/lib/google-calendar";
import { GOOGLE_CALENDAR_STATE_COOKIE } from "@/lib/google-calendar-oauth-state";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const state = crypto.randomBytes(24).toString("hex");
    const url = getGoogleCalendarAuthorizationUrl(state);
    const response = NextResponse.json({ url }, { status: 200 });
    response.cookies.set(GOOGLE_CALENDAR_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Failed to create Google Calendar OAuth URL:", error);
    return NextResponse.json(
      { error: "Google Calendar OAuth is not configured" },
      { status: 500 },
    );
  }
}
