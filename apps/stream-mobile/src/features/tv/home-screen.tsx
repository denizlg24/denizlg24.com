import type { Rail, TitleDetail } from "@repo/schemas/stream";
import { Info, Play, Popcorn } from "lucide-react-native";
import { useMemo } from "react";
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
import { type Spotlight, useSpot, useSpotlight } from "./spotlight";

export function railItems(rail: Rail): RailItem[] {
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
  const spotlight = useSpotlight<RailItem>();
  const hero = home.data?.hero ?? null;
  const rails = useMemo(
    () =>
      (home.data?.rails ?? [])
        .filter((rail) => rail.items.length > 0)
        .map((rail) => ({
          id: rail.id,
          label: rail.label,
          items: railItems(rail),
        })),
    [home.data],
  );

  return (
    <View style={styles.screen}>
      <HomeHeader
        spotlight={spotlight}
        hero={hero}
        navPreferred={!hero && !home.isPending}
      />
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
              items={rail.items}
              onFocusItem={spotlight.set}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * The backdrop, the spotlight and its buttons: the only part of Home that
 * follows focus. Play and More info act on whatever the remote last rested
 * on, so pressing up from a rail plays that title, not the featured one.
 */
function HomeHeader({
  spotlight,
  hero,
  navPreferred,
}: {
  spotlight: Spotlight<RailItem>;
  hero: TitleDetail | null;
  navPreferred: boolean;
}) {
  const spot = useSpot(spotlight);
  const shown = spot?.title ?? hero;
  const reason = spot ? spot.reason : hero?.tagline;
  return (
    <>
      <TvBackdrop title={shown} />
      <TvNavBar current="home" preferred={navPreferred} />
      <TvSpotlight title={shown} reason={reason}>
        {shown ? (
          <View style={styles.actions}>
            <Button
              label={spot?.progress ? "Resume" : "Play"}
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
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  loading: { flex: 1 },
  rails: { flex: 1, marginTop: spacing.lg },
  railsContent: { gap: spacing.xl, paddingBottom: TV_SAFE.y + spacing.xl },
});
