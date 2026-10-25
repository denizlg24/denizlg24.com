import type { TitleSummary } from "@repo/schemas/stream";
import { Bookmark } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useWatchlist } from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { Button, colors, EmptyState, spacing } from "@/ui";
import { TvBackdrop, TvNavBar, TvSpotlight } from "./chrome";
import { TV_SAFE } from "./layout";
import { TvPosterGrid } from "./poster-grid";

/** The lead profile's list, newest first. */
export function TvListScreen() {
  const { lead } = useAudience();
  const list = useWatchlist(lead.id);
  const [spot, setSpot] = useState<TitleSummary | null>(null);
  const titles = list.data ?? [];

  return (
    <View style={styles.screen}>
      <TvBackdrop title={spot} />
      <TvNavBar current="list" preferred={titles.length === 0} />
      <TvSpotlight title={spot} />
      {list.isPending ? (
        <ActivityIndicator
          color={colors.muted}
          size="large"
          style={styles.fill}
        />
      ) : list.isError && !list.data ? (
        <EmptyState
          icon={Bookmark}
          title="Your list didn't load"
          message="We couldn't reach Stream. Check that the TV is connected to the internet, then try again."
          action={
            <Button
              label="Try again"
              size="large"
              onPress={() => void list.refetch()}
            />
          }
        />
      ) : titles.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title={`${lead.name}'s list is empty`}
          message="Open any film or series and choose Add to my list. It shows up here, and on your phone too."
        />
      ) : (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <TvPosterGrid titles={titles} onFocusTitle={setSpot} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  fill: { flex: 1, marginTop: spacing.lg },
  content: { paddingBottom: TV_SAFE.y + spacing.xl },
});
