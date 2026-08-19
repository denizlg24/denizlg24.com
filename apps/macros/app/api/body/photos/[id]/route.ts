import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/connection";
import { weighInPhotos } from "@/db/schema";
import { getRequiredSession } from "@/lib/api/session";
import { deleteBodyPhotoObject } from "@/lib/body/storage";

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/body/photos/[id]">,
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const { id } = await context.params;
  const photo = await db.query.weighInPhotos.findFirst({
    where: and(
      eq(weighInPhotos.id, id),
      eq(weighInPhotos.userId, session.user.id),
    ),
  });
  if (!photo)
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  await deleteBodyPhotoObject(photo.storageKey);
  await db
    .delete(weighInPhotos)
    .where(
      and(eq(weighInPhotos.id, id), eq(weighInPhotos.userId, session.user.id)),
    );
  return new NextResponse(null, { status: 204 });
}
