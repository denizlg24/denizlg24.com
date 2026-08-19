import { pageMetadata } from "@/app/metadata"
import { FoodLogActivityClient } from "./food-log-activity-client"

export const metadata = pageMetadata(
  "Food Log Activity",
  "Review recent food log changes and logged nutrition activity."
)

export default function Page() {
  return <FoodLogActivityClient />
}
