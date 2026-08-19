import { pageMetadata } from "@/app/metadata"
import { PlatePageClient } from "./_components/plate-page-client"

export const metadata = pageMetadata(
  "Plate",
  "Build a plate and review its calories, macros, and nutrient balance."
)

export default function PlatePage() {
  return <PlatePageClient />
}
