import { eq } from "drizzle-orm"
import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db/connection"
import { userProfiles } from "@/db/schema"
import { auth } from "@/lib/auth"

const bodySchema = z.object({
  caloriePreference: z.enum(["consumed", "remaining"]),
})

export async function PUT(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  await db
    .update(userProfiles)
    .set({
      caloriePreference: parsed.data.caloriePreference,
      updatedAt: new Date(),
    })
    .where(eq(userProfiles.userId, session.user.id))

  return NextResponse.json({ caloriePreference: parsed.data.caloriePreference })
}
