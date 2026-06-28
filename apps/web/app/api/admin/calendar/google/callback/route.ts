import { type NextRequest, NextResponse } from "next/server";
import {
  createGoogleCalendarOAuthClient,
  encryptedRefreshToken,
  extractEmailFromIdToken,
  parseScope,
} from "@/lib/google-calendar";
import { GOOGLE_CALENDAR_STATE_COOKIE } from "@/lib/google-calendar-oauth-state";
import { connectDB } from "@/lib/mongodb";
import { getAdminSession } from "@/lib/require-admin";
import { CalendarExternalConnection } from "@/models/CalendarExternalConnection";

function calendarRedirect(request: NextRequest, status: string) {
  const url = new URL("/admin/dashboard/calendar", request.url);
  url.searchParams.set("googleCalendar", status);
  return NextResponse.redirect(url);
}

function deleteStateCookie(response: NextResponse) {
  response.cookies.delete(GOOGLE_CALENDAR_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = request.cookies.get(
    GOOGLE_CALENDAR_STATE_COOKIE,
  )?.value;

  if (!state || !expectedState || state !== expectedState) {
    return deleteStateCookie(
      NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 }),
    );
  }

  if (!code) {
    return deleteStateCookie(
      NextResponse.json({ error: "Missing OAuth code" }, { status: 400 }),
    );
  }

  try {
    const oauthClient = createGoogleCalendarOAuthClient();
    const { tokens } = await oauthClient.getToken(code);
    if (!tokens.refresh_token) {
      return deleteStateCookie(
        NextResponse.json(
          {
            error:
              "Google did not return a refresh token. Try reconnecting the calendar.",
          },
          { status: 400 },
        ),
      );
    }

    await connectDB();
    await CalendarExternalConnection.findOneAndUpdate(
      { provider: "google" },
      {
        $set: {
          provider: "google",
          enabled: true,
          calendarId: "primary",
          accountEmail: extractEmailFromIdToken(tokens.id_token),
          scope: parseScope(tokens.scope),
          encryptedRefreshToken: encryptedRefreshToken(tokens.refresh_token),
          connectedAt: new Date(),
        },
        $unset: { lastSyncError: "" },
      },
      { upsert: true, returnDocument: "after" },
    );

    return deleteStateCookie(calendarRedirect(request, "connected"));
  } catch (error) {
    console.error("Failed to connect Google Calendar:", error);
    return deleteStateCookie(
      NextResponse.json(
        { error: "Failed to connect Google Calendar" },
        { status: 500 },
      ),
    );
  }
}
