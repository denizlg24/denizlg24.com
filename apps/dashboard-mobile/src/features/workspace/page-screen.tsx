import {
  HeaderButton,
  haptics,
  Notice,
  Row,
  Screen,
  Section,
  spacing,
  Text,
} from "@repo/native-ui";
import { HOME_PAGE_ID } from "@repo/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { StyleSheet, View } from "react-native";
import {
  useWorkspaceOps,
  useWorkspacePage,
  useWorkspacePages,
  useWorkspaceRecords,
} from "@/api/workspace";
import { QueryState } from "@/features/shell/tab-page";
import { SITE } from "@/lib/config";
import { ago } from "@/lib/format";
import { DocumentBlocks, EmbeddedRecords, PageTitles } from "./blocks";
import { findPages, pageTitle } from "./pages";
import { collectRecordRefs } from "./record-refs";
import { PageRow } from "./workspace-screen";

export function WorkspacePageScreen({ id }: { id: string }) {
  const client = useQueryClient();
  const router = useRouter();
  const query = useWorkspacePage(id);
  const pages = useWorkspacePages();
  const ops = useWorkspaceOps(id);
  const page = query.data;
  const records = useWorkspaceRecords(collectRecordRefs(page?.blocks ?? []));
  const parent = pages.data?.find((item) => item.id === page?.parentId);
  const children = findPages(pages.data ?? [], "", id);
  const openDesktop = () =>
    void WebBrowser.openBrowserAsync(
      `${SITE}/admin/dashboard${id === HOME_PAGE_ID ? "" : `/page/${encodeURIComponent(id)}`}`,
    );
  return (
    <Screen
      onRefresh={() => {
        void query.refetch();
        void pages.refetch();
        void client.invalidateQueries({ queryKey: ["workspace", "view"] });
        void client.invalidateQueries({ queryKey: ["workspace", "records"] });
      }}
      refreshing={query.isRefetching}
    >
      <Stack.Screen
        options={{
          title: "",
          headerRight: () => (
            <View style={styles.actions}>
              {page && !page.locked && !page.deletedAt ? (
                <HeaderButton
                  symbol="plus"
                  label="Add text to page"
                  onPress={() =>
                    router.push({
                      pathname: "/workspace-capture",
                      params: { id },
                    })
                  }
                />
              ) : null}
              <HeaderButton
                symbol="arrow.up.right.square"
                label="Open page on web"
                onPress={openDesktop}
              />
            </View>
          ),
        }}
      />
      <QueryState error={query.error} loading={query.isPending} />
      {query.error ? (
        <Row title="Try again" onPress={() => void query.refetch()} />
      ) : null}
      {page?.deletedAt ? (
        <Text tone="secondary">
          This page is in the trash. Restore it on web to continue.
        </Text>
      ) : page ? (
        <View style={styles.document}>
          {parent ? (
            <Row
              title={pageTitle(parent)}
              subtitle="Parent page"
              onPress={() =>
                router.push({
                  pathname: "/more/page/[id]",
                  params: { id: parent.id },
                })
              }
            />
          ) : null}
          <View style={styles.title}>
            <Text variant="largeTitle" accessibilityRole="header" selectable>
              {pageTitle(page)}
            </Text>
            <Text variant="footnote" tone="secondary">
              {page.locked ? "Locked · " : ""}Updated {ago(page.updatedAt)}
            </Text>
          </View>
          {ops.error ? (
            <Notice
              message={`${ops.error.message}. Refresh the page before trying again.`}
            />
          ) : null}
          {page.blocks.length ? (
            <PageTitles
              value={Object.fromEntries(
                (pages.data ?? []).map((item) => [item.id, pageTitle(item)]),
              )}
            >
              <EmbeddedRecords
                value={{
                  records: Object.fromEntries(
                    (records.data?.records ?? []).map((record) => [
                      record.ref,
                      record,
                    ]),
                  ),
                  missing: records.data?.missing ?? [],
                  loading: records.isLoading,
                }}
              >
                <DocumentBlocks
                  blocks={page.blocks}
                  disabled={page.locked || ops.isPending || query.isRefetching}
                  onDesktop={openDesktop}
                  onTodo={(blockId, checked) =>
                    ops.mutate(
                      {
                        baseRev: page.rev,
                        ops: [{ op: "update", id: blockId, set: { checked } }],
                      },
                      { onSuccess: () => haptics.success() },
                    )
                  }
                />
              </EmbeddedRecords>
            </PageTitles>
          ) : (
            <Text tone="secondary">
              This page is empty. Add text to capture a thought.
            </Text>
          )}
          {records.error ? (
            <Notice message="Couldn’t load linked records. Pull to refresh and try again." />
          ) : null}
          {children.length ? (
            <Section title="Pages">
              {children.map((child) => (
                <PageRow key={child.id} page={child} />
              ))}
            </Section>
          ) : null}
          {!page.locked ? (
            <Row
              title="New subpage"
              chevron
              onPress={() =>
                router.push({
                  pathname: "/workspace-new",
                  params: { parentId: id },
                })
              }
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row" },
  document: { gap: spacing.xxl },
  title: { gap: spacing.sm },
});
