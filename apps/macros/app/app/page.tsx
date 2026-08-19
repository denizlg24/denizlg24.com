import { pageMetadata } from "@/app/metadata"
import { DashboardClient } from "./_components/dashboard-client"

export const metadata = pageMetadata(
  "Dashboard",
  "Review today's nutrition, weight signals, habits, and energy insights."
)

export default function DashboardPage() {
  return <DashboardClient />
}
