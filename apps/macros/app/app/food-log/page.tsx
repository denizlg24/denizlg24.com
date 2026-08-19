import { pageMetadata } from "@/app/metadata"
import { FoodLogClient } from "./_components/food-log-client"

export const metadata = pageMetadata(
  "Food Log",
  "Review and edit logged foods, recipes, calories, and macros by day."
)

export default function Page() {
  return <FoodLogClient />
}
