import { pageMetadata } from "@/app/metadata"
import { StrategyPageClient } from "./_components/strategy-page-client"

export const metadata = pageMetadata(
  "Strategy",
  "Review nutrition strategy and target planning."
)

export default function Page() {
  return <StrategyPageClient />
}
