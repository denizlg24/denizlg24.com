import {
  colors,
  HeaderButton,
  Row,
  Screen,
  spacing,
  Text,
  typeScale,
} from "@repo/native-ui";
import type { WorkspacePageSummary } from "@repo/schemas";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { useWorkspacePages } from "@/api/workspace";
import { QueryState } from "@/features/shell/tab-page";
import { findPages, pagePath, pageTitle } from "./pages";

export function PageRow({
  page,
  subtitle,
}: {
  page: WorkspacePageSummary;
  subtitle?: string;
}) {
  const router = useRouter();
  return (
    <Row
      title={pageTitle(page)}
      titleLines={0}
      subtitle={subtitle}
      chevron
      onPress={() =>
        router.push({ pathname: "/more/page/[id]", params: { id: page.id } })
      }
    />
  );
}

export function WorkspaceScreen() {
  const router = useRouter();
  const pages = useWorkspacePages();
  const [search, setSearch] = useState("");
  const visible = useMemo(
    () => findPages(pages.data ?? [], search),
    [pages.data, search],
  );
  return (
    <Screen
      onRefresh={() => void pages.refetch()}
      refreshing={pages.isRefetching}
    >
      <Stack.Screen
        options={{
          title: "Workspace",
          headerRight: () => (
            <HeaderButton
              symbol="plus"
              label="New page"
              onPress={() => router.push("/workspace-new")}
            />
          ),
        }}
      />
      <TextInput
        accessibilityLabel="Search workspace pages"
        placeholder="Search all pages"
        placeholderTextColor={colors.secondaryLabel}
        value={search}
        onChangeText={setSearch}
        clearButtonMode="while-editing"
        returnKeyType="search"
        style={[typeScale.body, styles.search]}
      />
      <QueryState error={pages.error} loading={pages.isPending} />
      {pages.error ? (
        <Row title="Try again" onPress={() => void pages.refetch()} />
      ) : null}
      {pages.data && visible.length === 0 ? (
        <Text tone="secondary" style={styles.empty}>
          {search.trim()
            ? "No pages match your search."
            : "No pages yet. Create a page to start your workspace."}
        </Text>
      ) : null}
      {visible.map((page) => (
        <PageRow
          key={page.id}
          page={page}
          subtitle={
            search.trim()
              ? pagePath(page, pages.data ?? [])
              : page.locked
                ? "Locked"
                : undefined
          }
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { color: colors.label, minHeight: 48, marginBottom: spacing.lg },
  empty: { paddingVertical: spacing.xxl },
});
