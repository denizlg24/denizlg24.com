import { pageMetadata } from "@/app/metadata"
import { FoodsPageClient } from "./_components/foods-page-client"

export const metadata = pageMetadata(
  "Foods",
  "Manage local food snapshots used for stable logging and recipes."
)

export default function Page() {
  return <FoodsPageClient />
}
