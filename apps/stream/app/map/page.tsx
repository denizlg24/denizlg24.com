import { titleIdSchema } from "@repo/schemas/stream";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EndlessGrid } from "@/components/grid/endless-grid";
import { TopBar } from "@/components/top-bar";
import { audienceProfiles, isTv, requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Map" };

export default async function MapPage({ searchParams }: PageProps<"/map">) {
  const { focus } = await searchParams;
  const focusId = titleIdSchema.safeParse(focus);
  const viewer = await requireViewer(
    focusId.success ? `/map?focus=${focusId.data}` : "/map",
  );
  if (viewer.layout === "classic") redirect("/");
  return (
    <div className="relative h-dvh overflow-hidden">
      <EndlessGrid
        profiles={viewer.audience.map((profile) => profile.id)}
        tv={await isTv()}
        focusId={focusId.success ? focusId.data : null}
      />
      <TopBar audience={audienceProfiles(viewer)} layout="studio" overlay />
    </div>
  );
}
