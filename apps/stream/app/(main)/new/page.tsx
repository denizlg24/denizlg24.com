import type { Metadata } from "next";

import { BrowsePage } from "@/components/browse/browse-page";

export const metadata: Metadata = { title: "New & Popular" };

export default function Page() {
  return <BrowsePage tab="new" />;
}
