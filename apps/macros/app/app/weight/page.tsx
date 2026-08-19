import { pageMetadata } from "@/app/metadata"
import { WeightPageClient } from "./weight-page-client"

export const metadata = pageMetadata(
  "Weight",
  "Review weight trends, expenditure estimates, and body metrics."
)

export default function Page() {
  return <WeightPageClient />
}
