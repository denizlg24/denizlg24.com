import { timingSafeEqual } from "node:crypto";
import { mobileNotifyInputSchema, resolveMobileNotify } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { notifyDashboard } from "@/lib/mobile-push";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Pushes from outside web: the cloud API's ops notifier, with
 * `MOBILE_NOTIFY_TOKEN` (equal on api and web), and the status page, with its
 * service-client token for this site. Each device's toggles are applied here.
 */
function matchesNotifyToken(request: NextRequest): boolean {
  const token = process.env.MOBILE_NOTIFY_TOKEN?.trim();
  const provided = request.headers.get("authorization");
  if (!token || !provided) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: NextRequest) {
  if (!matchesNotifyToken(request)) {
    const authError = await requireAdmin(request);
    if (authError) return authError;
  }
  const parsed = mobileNotifyInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid notification" },
      { status: 400 },
    );
  }
  const resolved = resolveMobileNotify(parsed.data);
  if (!resolved) return NextResponse.json({ sent: 0, skipped: true });
  const sent = await notifyDashboard({
    kind: resolved.kind,
    ...(resolved.level ? { level: resolved.level } : {}),
    title: parsed.data.title,
    ...(parsed.data.body ? { body: parsed.data.body } : {}),
    subject: parsed.data.dedupeKey,
    ...(parsed.data.url ? { url: parsed.data.url } : {}),
  });
  return NextResponse.json({ sent });
}
