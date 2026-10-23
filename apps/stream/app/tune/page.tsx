import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TopBar } from "@/components/top-bar";
import { Tuner } from "@/components/tune/tuner";
import { tuneFromParams } from "@/lib/tune";
import { audienceProfiles, requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Tune" };

export default async function TunePage({ searchParams }: PageProps<"/tune">) {
  const viewer = await requireViewer("/tune");
  if (viewer.layout === "classic") redirect("/search");
  const params = await searchParams;
  return (
    <div className="min-h-dvh">
      <TopBar audience={audienceProfiles(viewer)} layout="studio" />
      <Tuner
        initial={tuneFromParams(params)}
        profileId={
          (
            viewer.audience.find((profile) => profile.kids) ??
            viewer.audience[0]
          ).id
        }
        focusSearch={params.focus === "search"}
      />
    </div>
  );
}
