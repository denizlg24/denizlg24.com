import { Row, spacing, Text } from "@repo/native-ui";
import { type BlockOf, parseEntityRef, VIEW_SOURCES } from "@repo/schemas";
import { type Href, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useWorkspaceView } from "@/api/workspace";
import { QueryState } from "@/features/shell/tab-page";
import { viewValueText } from "./view-values";

export function nativeRecord(ref: string | null): Href | null {
  const entity = ref ? parseEntityRef(ref) : null;
  if (!entity) return null;
  switch (entity.kind) {
    case "page":
      return { pathname: "/more/page/[id]", params: { id: entity.id } };
    case "note":
      return { pathname: "/more/note/[id]", params: { id: entity.id } };
    case "course":
      return { pathname: "/calendar/course/[id]", params: { id: entity.id } };
    case "envelope":
      return { pathname: "/money/envelope/[id]", params: { id: entity.id } };
    case "portfolio":
      return { pathname: "/money/portfolio/[id]", params: { id: entity.id } };
    case "finance-entry":
      return { pathname: "/money/entry/[id]", params: { id: entity.id } };
    case "agent-task":
      return "/more/tasks";
    case "resource":
      return "/more/resources";
    default:
      return null;
  }
}

/** Saved desktop filters and sort, presented as readable rows on a phone. */
export function WorkspaceViewBlock({
  block,
  onDesktop,
}: {
  block: BlockOf<"view">;
  onDesktop: () => void;
}) {
  const { id: _id, type: _type, title, ...config } = block;
  const query = useWorkspaceView(config);
  const router = useRouter();
  const source = VIEW_SOURCES[block.source];
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];
  const first = query.data?.pages[0];
  const fields = (block.fields ?? source.defaultFields)
    .filter((field) => field !== source.titleField)
    .slice(0, 3);
  return (
    <View style={styles.view}>
      <Text variant="title3" accessibilityRole="header">
        {title || source.label}
      </Text>
      <QueryState error={query.error} loading={query.isPending} />
      {query.error ? (
        <Row title="Try again" onPress={() => void query.refetch()} />
      ) : null}
      {first && rows.length === 0 ? (
        <Text tone="secondary">No matching records.</Text>
      ) : null}
      {rows.map((row) => {
        const route = nativeRecord(row.ref);
        return (
          <Row
            key={row.id}
            title={viewValueText(row.values[source.titleField]) || "Untitled"}
            titleLines={0}
            subtitle={fields
              .flatMap((field) => {
                const value = viewValueText(row.values[field]);
                return value
                  ? [`${source.fields[field]?.label ?? field}: ${value}`]
                  : [];
              })
              .join(" · ")}
            chevron
            onPress={route ? () => router.push(route) : onDesktop}
          />
        );
      })}
      {query.hasNextPage ? (
        <Row
          title={query.isFetchingNextPage ? "Loading…" : "Load more"}
          disabled={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
        />
      ) : null}
      {first ? (
        <Text variant="footnote" tone="secondary">
          {first.total} matching
          {first.truncated ? " · Results cover the newest records" : ""}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ view: { gap: spacing.sm } });
