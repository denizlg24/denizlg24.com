import type { Rail } from "@repo/schemas/stream";
import { Info, Play, Popcorn } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useHome } from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { Button, colors, EmptyState, spacing } from "@/ui";
import {
  type RailItem,
  TvBackdrop,
  TvNavBar,
  TvRail,
  TvSpotlight,
} from "./chrome";
import { TV_SAFE } from "./layout";
import { openTvTitle, playOnTv } from "./open";

function railItems(rail: Rail): RailItem[] {
  switch (rail.kind) {
    case "continue":
      return rail.items.map(({ title, progress }) => ({
        key: `${rail.id}:${title.id}`,
        title,
        progress,
        onPress: () => playOnTv(title.id, progress.episodeId),
      }));
    case "recommended":
      return rail.items.map(({ title, reason }) => ({
        key: `${rail.id}:${title.id}`,
        title,
        reason,
        onPress: () => openTvTitle(title.id),
      }));
    case "titles":
      return rail.items.map((title) => ({
        key: `${rail.id}:${title.id}`,
        title,
        onPress: () => openTvTitle(title.id),
      }));
  }
}

/** `GET /home` for the lead profile: a featured title, then the rails. */
export function TvHomeScreen() {
  const { lead } = useAudience();
  const home = useHome(lead.id);
  const hero = home.data?.hero ?? null;
  // Whatever the remote last rested on; Play and More info act on it, so
  // pressing up from a rail plays that title, not the featured one.
  const [spot, setSpot] = useState<RailItem | null>(null);
  const rails = home.data?.rails.filter((rail) => rail.items.length > 0) ?? [];
  const shown = spot?.title ?? hero;
  const resuming = spot?.progress !== undefined;

  return (
    <View style={styles.screen}>
      <TvBackdrop title={shown} />
      <TvNavBar current="home" preferred={!hero && !home.isPending} />
      <TvSpotlight title={shown} reason={spot ? spot.reason : hero?.tagline}>
        {shown ? (
          <View style={styles.actions}>
            <Button
              label={resuming ? "Resume" : "Play"}
              icon={Play}
              filledIcon
              size="large"
              preferred={hero !== null}
              onPress={() =>
                spot?.progress ? spot.onPress() : playOnTv(shown.id)
              }
            />
            <Button
              label="More info"
              icon={Info}
              variant="secondary"
              size="large"
              onPress={() => openTvTitle(shown.id)}
            />
          </View>
        ) : null}
      </TvSpotlight>
      {home.isPending ? (
        <ActivityIndicator
          color={colors.muted}
          size="large"
          style={styles.loading}
        />
      ) : home.isError && !home.data ? (
        <EmptyState
          icon={Popcorn}
          title="This didn't load"
          message="We couldn't reach Stream. Check that the TV is connected to the internet, then try again."
          action={
            <Button
              label="Try again"
              size="large"
              preferred
              onPress={() => void home.refetch()}
            />
          }
        />
      ) : rails.length === 0 ? (
        <EmptyState
          icon={Popcorn}
          title="Nothing here yet"
          message="Films and series are still being added. Please check back a little later."
        />
      ) : (
        <ScrollView
          style={styles.rails}
          contentContainerStyle={styles.railsContent}
          showsVerticalScrollIndicator={false}
        >
          {rails.map((rail) => (
            <TvRail
              key={rail.id}
              label={rail.label}
              items={railItems(rail)}
              onFocusItem={setSpot}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  loading: { flex: 1 },
  rails: { flex: 1, marginTop: spacing.lg },
  railsContent: { gap: spacing.xl, paddingBottom: TV_SAFE.y + spacing.xl },
});
