import { pageMetadata } from "@/app/metadata";
import { StatisticsPageClient } from "./statistics-page-client";

export const metadata = pageMetadata(
  "Statistics",
  "Review expenditure, intake, adherence, targets, and weight trends.",
);

export default function StatisticsPage() {
  return <StatisticsPageClient />;
}
