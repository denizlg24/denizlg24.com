import { pageMetadata } from "@/app/metadata";
import { BodyPageClient } from "./body-page-client";

export const metadata = pageMetadata(
  "Body & habits",
  "Track measurements, activity, hydration, and daily habits.",
);

export default function BodyPage() {
  return <BodyPageClient />;
}
