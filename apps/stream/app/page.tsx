import { ClassicHome } from "@/components/classic/classic-home";
import { Edition } from "@/components/tonight/edition";
import { TopBar } from "@/components/top-bar";
import { inWatchlist } from "@/lib/catalog";
import { buildHome } from "@/lib/home";
import { buildTonight } from "@/lib/tonight";
import { audienceProfiles, requireViewer } from "@/lib/viewer";

export default async function HomePage() {
  const viewer = await requireViewer("/");
  const audience = audienceProfiles(viewer);

  if (viewer.layout === "classic") {
    return (
      <div data-classic className="min-h-dvh">
        <TopBar audience={audience} layout="classic" />
        <ClassicHome home={await buildHome(viewer.audience[0])} />
      </div>
    );
  }

  const tonight = await buildTonight(viewer.audience);
  const leadSaved = tonight.lead
    ? await inWatchlist(viewer.audience[0].id, tonight.lead.title.id)
    : false;
  return (
    <div className="relative min-h-dvh">
      <TopBar audience={audience} layout="studio" overlay />
      <Edition tonight={tonight} leadSaved={leadSaved} />
    </div>
  );
}
