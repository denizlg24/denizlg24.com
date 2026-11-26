import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dashboardReturn } from "@/lib/assistant-types";
import {
  appOrigin,
  cookieOptions,
  currentUser,
  demoEnabled,
  json,
  sameOrigin,
  sessionCookie,
} from "@/lib/auth";
import { createSession, sessionAge } from "@/lib/db";

export async function POST(request: Request) {
  if (!demoEnabled()) return json({ error: "Preview is disabled" }, 404);
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const origin = appOrigin(request);
  const destination = new URL("/", origin);
  if (
    request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  ) {
    const form = await request.formData().catch(() => null);
    destination.hash = dashboardReturn(form?.get("from"));
  }
  const response = NextResponse.redirect(destination, 303);
  if (await currentUser()) return response;
  const token = await createSession({
    id: `demo:${randomUUID()}`,
    name: "Preview account",
    email: null,
    demo: true,
  });
  response.cookies.set(
    sessionCookie(origin),
    token,
    cookieOptions(origin, sessionAge),
  );
  return response;
}
