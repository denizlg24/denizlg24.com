import { eq } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { pageMetadata } from "@/app/metadata"
import { db } from "@/db/connection"
import { userProfiles } from "@/db/schema"
import { auth } from "@/lib/auth"
import { CompleteRegistrationForm } from "./_components/complete-registration-form"

export const metadata = pageMetadata(
  "Complete Registration",
  "Finish setting up your Macros profile."
)

export default async function CompleteRegistrationPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect("/")
  }

  const userProfile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, session.user.id),
    columns: { onboardingCompletedAt: true },
  })

  if (userProfile?.onboardingCompletedAt) {
    redirect("/app")
  }

  return <CompleteRegistrationForm />
}
