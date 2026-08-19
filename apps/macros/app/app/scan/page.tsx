import { pageMetadata } from "@/app/metadata"
import { ScanPageClient } from "./_components/scan-page-client"

export const metadata = pageMetadata(
  "Scan",
  "Scan barcodes or nutrition labels to add foods faster."
)

export default function Page() {
  return <ScanPageClient />
}
