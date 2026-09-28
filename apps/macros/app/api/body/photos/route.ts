import { randomUUID } from "node:crypto";
import {
  macrosBodyPhotoAngleSchema as angleSchema,
  macrosBodyPhotoCompleteBodySchema as completeSchema,
  type MacrosBodyPhotoCompleteResponse,
  type MacrosBodyPhotosResponse,
  type MacrosBodyPhotoUploadResponse,
  macrosBodyPhotoUploadBodySchema as uploadSchema,
} from "@repo/schemas/macros";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/connection";
import { weighInPhotos, weighIns } from "@/db/schema";
import { getRequiredSession } from "@/lib/api/session";
import {
  createBodyPhotoDownloadUrl,
  createBodyPhotoUploadUrl,
  inspectBodyPhoto,
} from "@/lib/body/storage";

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const requestedAngle = new URL(request.url).searchParams.get("angle");
  const parsedAngle = requestedAngle
    ? angleSchema.safeParse(requestedAngle)
    : null;
  if (parsedAngle && !parsedAngle.success)
    return NextResponse.json({ error: "Invalid angle" }, { status: 400 });
  const rows = await db
    .select({
      id: weighInPhotos.id,
      angle: weighInPhotos.angle,
      storageKey: weighInPhotos.storageKey,
      width: weighInPhotos.width,
      height: weighInPhotos.height,
      capturedAt: weighInPhotos.capturedAt,
      logDate: weighIns.logDate,
      weightKg: weighIns.weightKg,
    })
    .from(weighInPhotos)
    .innerJoin(weighIns, eq(weighIns.id, weighInPhotos.weighInId))
    .where(
      and(
        eq(weighInPhotos.userId, session.user.id),
        ...(parsedAngle?.success
          ? [eq(weighInPhotos.angle, parsedAngle.data)]
          : []),
      ),
    )
    .orderBy(desc(weighIns.logDate));
  const photos = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      capturedAt: row.capturedAt?.toISOString() ?? null,
      weightKg: Number(row.weightKg),
      url: await createBodyPhotoDownloadUrl(row.storageKey),
    })),
  );
  return NextResponse.json({ photos } satisfies MacrosBodyPhotosResponse);
}

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid upload request", issues: parsed.error.issues },
      { status: 400 },
    );
  const latest = await db.query.weighIns.findFirst({
    where: eq(weighIns.userId, session.user.id),
    orderBy: [desc(weighIns.logDate)],
  });
  if (!latest)
    return NextResponse.json(
      { error: "Add a weigh-in before taking a progress photo" },
      { status: 409 },
    );
  const storageKey = `users/${session.user.id}/progress/${latest.logDate}/${parsed.data.angle}/${randomUUID()}.jpg`;
  const uploadUrl = await createBodyPhotoUploadUrl(
    storageKey,
    parsed.data.mimeType,
  );
  return NextResponse.json({
    uploadUrl,
    storageKey,
    weighInId: latest.id,
  } satisfies MacrosBodyPhotoUploadResponse);
}

export async function PUT(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = completeSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (
    !parsed.success ||
    !parsed.data.storageKey.startsWith(`users/${session.user.id}/progress/`)
  )
    return NextResponse.json(
      {
        error: "Invalid upload completion",
        issues: parsed.success ? undefined : parsed.error.issues,
      },
      { status: 400 },
    );
  const latest = await db.query.weighIns.findFirst({
    where: eq(weighIns.userId, session.user.id),
    orderBy: [desc(weighIns.logDate)],
  });
  if (!latest)
    return NextResponse.json({ error: "Weigh-in not found" }, { status: 409 });
  const object = await inspectBodyPhoto(parsed.data.storageKey);
  if (!object.ContentLength || object.ContentLength > 3_000_000)
    return NextResponse.json(
      { error: "Uploaded image is empty or too large" },
      { status: 400 },
    );
  const [photo] = await db
    .insert(weighInPhotos)
    .values({
      userId: session.user.id,
      weighInId: latest.id,
      angle: parsed.data.angle,
      storageKey: parsed.data.storageKey,
      objectUrl: parsed.data.storageKey,
      mimeType: "image/jpeg",
      byteSize: object.ContentLength,
      width: parsed.data.width,
      height: parsed.data.height,
      sha256: parsed.data.sha256,
      capturedAt: parsed.data.capturedAt
        ? new Date(parsed.data.capturedAt)
        : new Date(),
    })
    .returning();
  if (!photo) throw new Error("Failed to save progress photo");
  return NextResponse.json(
    {
      photo: {
        ...photo,
        capturedAt: photo.capturedAt?.toISOString() ?? null,
        uploadedAt: photo.uploadedAt.toISOString(),
      },
    } satisfies MacrosBodyPhotoCompleteResponse,
    { status: 201 },
  );
}
