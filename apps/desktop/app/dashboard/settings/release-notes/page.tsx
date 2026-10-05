import { loadDesktopChangelog } from "@/lib/changelog";
import { ReleaseNotesPage } from "./_components/release-notes-section";

export default async function Page() {
  return <ReleaseNotesPage releases={await loadDesktopChangelog()} />;
}
