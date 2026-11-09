import { TabHeading } from "@/components/browse/browse-page";
import { BrowseSkeleton } from "@/components/browse/browse-view";

export default function Loading() {
  return <BrowseSkeleton heading={<TabHeading tab="films" />} />;
}
