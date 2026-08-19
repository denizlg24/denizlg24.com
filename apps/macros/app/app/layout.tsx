import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import { QueryProvider } from "@/components/query-provider"
import { db } from "@/db/connection"
import { userProfiles } from "@/db/schema"
import { getSession } from "@/lib/session"
import { DashboardHeader } from "./_components/dashboard-header"
import { TimezoneSync } from "./_components/timezone-sync"

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await getSession()

  if (!session) {
    redirect("/")
  }

  const userProfile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, session.user.id),
    columns: { onboardingCompletedAt: true, timezone: true },
  })

  if (!userProfile?.onboardingCompletedAt) {
    redirect("/register/complete")
  }

  return (
    <QueryProvider userId={session.user.id}>
      <TimezoneSync initialTimezone={userProfile.timezone} />
      <main className="pb-safe-end">{children}</main>
      <DashboardHeader />
    </QueryProvider>
  )
}
