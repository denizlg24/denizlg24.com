import { pageMetadata } from "@/app/metadata"
import { WeighInPageClient } from "./weigh-in-page-client"

export const metadata = pageMetadata(
  "Weigh In",
  "Log body weight and weigh-in photo metadata."
)

export default function Page() {
  return <WeighInPageClient />
}
