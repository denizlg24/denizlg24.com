import type { TitleSummary } from "@repo/schemas/stream";
import { UserRound } from "lucide-react-native";
import { useMemo } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useActorTitles } from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { Button, colors, EmptyState, spacing, Text } from "@/ui";
import { FocusedSpotlight, FocusedTitle } from "./chrome";
import { TV_SAFE } from "./layout";
import { TvPosterGrid } from "./poster-grid";
import { useSpotlight } from "./spotlight";

/** Everything in the catalogue with one actor in it, newest first. */
export function TvActorScreen({ name }: { name: string }) {
  const { lead } = useAudience();
  const result = useActorTitles(name, lead.id);
  const spotlight = useSpotlight<TitleSummary>();
  const titles = useMemo(
    () => result.data?.pages.flatMap((page) => page.titles) ?? [],
    [result.data],
  );

  return (
    <View style={styles.screen}>
      <FocusedTitle spotlight={spotlight} />
      <View style={styles.head}>
        <Text variant="marquee" numberOfLines={1}>
          {name}
        </Text>
      </View>
      <FocusedSpotlight spotlight={spotlight} />
      {result.isPending ? (
        <ActivityIndicator
          color={colors.muted}
          size="large"
          style={styles.fill}
        />
      ) : result.isError && !result.data ? (
        <EmptyState
          icon={UserRound}
          title="This didn't load"
          message="We couldn't reach Stream. Check that the TV is connected to the internet, then try again."
          action={
            <Button
              label="Try again"
              size="large"
              preferred
              onPress={() => void result.refetch()}
            />
          }
        />
      ) : titles.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={`Nothing with ${name} yet`}
          message="None of their films or series are in the catalogue at the moment. Press back to return."
        />
      ) : (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <TvPosterGrid titles={titles} onFocusTitle={spotlight.set} />
          {result.hasNextPage ? (
            <View style={styles.more}>
              <Button
                label="Show more"
                variant="secondary"
                size="large"
                loading={result.isFetchingNextPage}
                onPress={() => void result.fetchNextPage()}
              />
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  head: { paddingHorizontal: TV_SAFE.x, paddingTop: TV_SAFE.y + spacing.lg },
  fill: { flex: 1, marginTop: spacing.lg },
  content: { paddingBottom: TV_SAFE.y + spacing.xl, gap: spacing.lg },
  more: { paddingHorizontal: TV_SAFE.x, flexDirection: "row" },
});
