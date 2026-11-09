import type { Metadata } from "next";

import { BrowsePage } from "@/components/browse/browse-page";

export const metadata: Metadata = { title: "Films" };

export default function Page() {
  return <BrowsePage tab="films" />;
}
