import type { Metadata } from "next";

import { BrowsePage } from "@/components/browse/browse-page";

export const metadata: Metadata = { title: "Home" };

export default function Page() {
  return <BrowsePage tab="home" />;
}
