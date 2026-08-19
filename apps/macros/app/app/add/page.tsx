import { pageMetadata } from "@/app/metadata"
import { AddFoodPageClient } from "./_components/add-food-page-client"

export const metadata = pageMetadata(
  "Add Food",
  "Search foods, scan barcodes, and add nutrition entries to your food log."
)

export default function Page() {
  return <AddFoodPageClient />
}
