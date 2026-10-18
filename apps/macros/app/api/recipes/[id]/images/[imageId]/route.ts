import { recipeImageKeys } from "@repo/macros-core/recipe-content";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/connection";
import { recipes } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createBodyPhotoDownloadUrl } from "@/lib/body/storage";
import { isSuspended } from "@/lib/moderation/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const { id, imageId } = await params;
  if (
    !z.uuid().safeParse(id).success ||
    !z.uuid().safeParse(imageId.replace(/\.jpg$/, "")).success
  )
    return new NextResponse(null, { status: 404 });
  const recipe = await db.query.recipes.findFirst({
    where: and(eq(recipes.id, id), eq(recipes.status, "active")),
  });
  if (!recipe || (await isSuspended(recipe.userId)))
    return new NextResponse(null, { status: 404 });
  if (!recipe.publishedAt) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user.id !== recipe.userId)
      return new NextResponse(null, { status: 404 });
  }
  const key = `users/${recipe.userId}/recipes/${imageId}`;
  if (!recipeImageKeys(recipe).includes(key))
    return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(
    await createBodyPhotoDownloadUrl(key, "image/jpeg"),
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
