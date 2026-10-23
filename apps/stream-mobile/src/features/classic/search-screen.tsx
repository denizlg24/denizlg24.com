import { Search, SearchX } from "lucide-react-native";
import { useDeferredValue, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useTitles } from "@/api/stream";
import { EMPTY_FILTERS } from "@/lib/title-query";
import { colors, EmptyState, gutter, radius, spacing, Text } from "@/ui";
import { TitleRow } from "./title-row";

/** One big field; results as a list of poster, title and year. */
export function ClassicSearchScreen() {
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim());
  const titles = useTitles({ ...EMPTY_FILTERS, q: deferred });
  const items = deferred
    ? (titles.data?.pages.flatMap((page) => page.titles) ?? [])
    : [];

  return (
    <FlatList
      style={styles.screen}
      data={items}
      keyExtractor={(title) => title.id}
      renderItem={({ item }) => <TitleRow title={item} />}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (deferred && titles.hasNextPage && !titles.isFetchingNextPage) {
          void titles.fetchNextPage();
        }
      }}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text variant="classicTitle">Search</Text>
          <Text variant="classicBody" color="muted">
            Type the name of a film or series.
          </Text>
          <View style={styles.field}>
            <Search color={colors.muted} size={26} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="For example: The Godfather"
              placeholderTextColor={colors.faint}
              returnKeyType="search"
              autoCorrect={false}
              clearButtonMode="while-editing"
              accessibilityLabel="Search for a film or series"
              style={styles.input}
            />
          </View>
        </View>
      }
      ListEmptyComponent={
        !deferred ? null : titles.isPending ? (
          <ActivityIndicator
            color={colors.muted}
            size="large"
            style={styles.loading}
          />
        ) : (
          <EmptyState
            large
            icon={SearchX}
            title="Nothing found"
            message={
              titles.isError
                ? "We couldn't reach Stream. Check your internet connection and try again."
                : `We couldn't find anything called “${deferred}”. Check the spelling, or try fewer words.`
            }
          />
        )
      }
      ListFooterComponent={
        titles.isFetchingNextPage ? (
          <ActivityIndicator color={colors.muted} style={styles.loading} />
        ) : null
      }
      contentContainerStyle={styles.content}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { paddingBottom: spacing.xxxl * 2 },
  header: {
    paddingHorizontal: gutter,
    paddingTop: spacing.xl,
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    borderWidth: 2,
    borderColor: colors.hairline,
  },
  input: {
    flex: 1,
    color: colors.paper,
    fontSize: 22,
    paddingVertical: spacing.md,
  },
  loading: { paddingVertical: spacing.xxl },
});
