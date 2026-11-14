import { Row, Section, Text } from "@repo/native-ui";
import { HOME_PAGE_ID } from "@repo/schemas";
import { useRouter } from "expo-router";
import { useWorkspacePages, useWorkspacePrefs } from "@/api/workspace";
import { livePages } from "./pages";
import { PageRow } from "./workspace-screen";

/** Desktop favorites are the same destinations here, with recently edited pages as a fallback. */
export function WorkspaceShortcuts() {
  const router = useRouter();
  const pages = useWorkspacePages();
  const prefs = useWorkspacePrefs();
  const live = livePages(pages.data ?? []).filter(
    (page) => page.id !== HOME_PAGE_ID,
  );
  const favorites =
    prefs.data?.favorites.flatMap((ref) => {
      const page = live.find((item) => ref === `page:${item.id}`);
      return page ? [page] : [];
    }) ?? [];
  const recent = [...live].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const picked = (favorites.length ? favorites : recent).slice(0, 3);
  return (
    <Section title="Workspace">
      <Row
        title="Home"
        subtitle="Your desktop home and focus"
        chevron
        onPress={() =>
          router.push({
            pathname: "/more/page/[id]",
            params: { id: HOME_PAGE_ID },
          })
        }
      />
      {picked.map((page) => (
        <PageRow key={page.id} page={page} />
      ))}
      {pages.error ? (
        <Text variant="footnote" tone="secondary">
          Couldn’t refresh your pages. Open Workspace to retry.
        </Text>
      ) : null}
      <Row
        title="All pages"
        chevron
        separator={false}
        onPress={() => router.push("/more/workspace")}
      />
    </Section>
  );
}
