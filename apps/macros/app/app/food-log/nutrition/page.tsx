import { pageMetadata } from "@/app/metadata"
import { NutritionOverviewClient } from "./_components/nutrition-overview-client"

export const metadata = pageMetadata(
  "Nutrition Overview",
  "Review macro and micronutrient totals against nutrition targets."
)

export default function Page() {
  return <NutritionOverviewClient />
}
