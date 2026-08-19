import { eq } from "drizzle-orm"
import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db/connection"
import { userProfiles } from "@/db/schema"
import { auth } from "@/lib/auth"

const timezoneSchema = z.object({
  timezone: z.string().min(1),
})

function isValidTimezone(timezone: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format()
    return true
  } catch {
    return false
  }
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = timezoneSchema.safeParse(body)

  if (!parsed.success || !isValidTimezone(parsed.data.timezone)) {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 })
  }

  const now = new Date()

  await db
    .update(userProfiles)
    .set({ timezone: parsed.data.timezone, updatedAt: now })
    .where(eq(userProfiles.userId, session.user.id))

  return NextResponse.json({ timezone: parsed.data.timezone })
}
