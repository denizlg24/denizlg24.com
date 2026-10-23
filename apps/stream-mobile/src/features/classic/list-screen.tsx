import { router } from "expo-router";
import { Bookmark } from "lucide-react-native";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { useWatchlist } from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { Button, colors, EmptyState, gutter, spacing, Text } from "@/ui";
import { TitleRow } from "./title-row";

export function ClassicListScreen() {
  const { lead } = useAudience();
  const list = useWatchlist(lead.id);
  return (
    <FlatList
      style={styles.screen}
      data={list.data ?? []}
      keyExtractor={(title) => title.id}
      renderItem={({ item }) => <TitleRow title={item} />}
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      ListHeaderComponent={
        <Text variant="classicTitle" style={styles.header}>
          My list
        </Text>
      }
      ListEmptyComponent={
        list.isPending ? (
          <ActivityIndicator color={colors.muted} size="large" />
        ) : (
          <EmptyState
            large
            icon={Bookmark}
            title="Your list is empty"
            message="When you see something you'd like to watch, press “Add to my list” and it will be kept here for you."
            action={
              <Button
                label="Go to Home"
                size="classic"
                onPress={() => router.navigate("/home")}
              />
            }
          />
        )
      }
      ListFooterComponent={
        <View style={styles.footer}>
          <Button
            label="Settings and profiles"
            variant="secondary"
            size="classic"
            block
            onPress={() => router.push("/account")}
          />
        </View>
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
    paddingBottom: spacing.sm,
  },
  footer: { padding: gutter, marginTop: spacing.xl },
});
