import type { TitleSummary, Tonight } from "@repo/schemas/stream";
import { Info, Play, Popcorn } from "lucide-react-native";
import { useMemo } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useTonight } from "@/api/stream";
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

function tonightRails(
  tonight: Tonight,
): { label: string; items: RailItem[] }[] {
  const picks = (
    id: string,
    items: { title: TitleSummary; reason?: string }[],
  ): RailItem[] =>
    items.map(({ title, reason }) => ({
      key: `${id}:${title.id}`,
      title,
      reason,
      onPress: () => openTvTitle(title.id),
    }));
  const double = tonight.doubleFeature;
  return [
    {
      label: "Continue watching",
      items: tonight.continue.map(({ title, progress }) => ({
        key: `continue:${title.id}`,
        title,
        progress,
        onPress: () => playOnTv(title.id, progress.episodeId),
      })),
    },
    { label: "Also tonight", items: picks("programme", tonight.programme) },
    {
      label: "Double feature",
      items: double
        ? picks("double", [
            { title: double.first, reason: double.reason },
            { title: double.second, reason: double.reason },
          ])
        : [],
    },
    {
      label: "New this year",
      items: picks(
        "fresh",
        tonight.fresh.map((title) => ({ title })),
      ),
    },
  ].filter((rail) => rail.items.length > 0);
}

/** The sofa's evening, as on the web's front page: one lead, then the programme. */
export function TvTonightScreen() {
  const { key } = useAudience();
  const tonight = useTonight(key);
  const spotlight = useSpotlight<RailItem>();
  const rails = useMemo(
    () => (tonight.data ? tonightRails(tonight.data) : []),
    [tonight.data],
  );
  const lead = tonight.data?.lead ?? null;

  return (
    <View style={styles.screen}>
      <TonightHeader
        spotlight={spotlight}
        lead={lead}
        navPreferred={!lead && !tonight.isPending}
      />
      {tonight.isPending ? (
        <ActivityIndicator
          color={colors.muted}
          size="large"
          style={styles.fill}
        />
      ) : tonight.isError && !tonight.data ? (
        <EmptyState
          icon={Popcorn}
          title="Tonight's programme didn't arrive"
          message="We couldn't reach Stream. Check that the TV is connected to the internet, then try again."
          action={
            <Button
              label="Try again"
              size="large"
              preferred
              onPress={() => void tonight.refetch()}
            />
          }
        />
      ) : rails.length === 0 && !lead ? (
        <EmptyState
          icon={Popcorn}
          title="Nothing on tonight yet"
          message="The catalogue is still being filled in. Tonight's picks will appear here as soon as there's enough to choose from."
        />
      ) : (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {rails.map((rail) => (
            <TvRail
              key={rail.label}
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

function TonightHeader({
  spotlight,
  lead,
  navPreferred,
}: {
  spotlight: Spotlight<RailItem>;
  lead: Tonight["lead"];
  navPreferred: boolean;
}) {
  const spot = useSpot(spotlight);
  const shown = spot?.title ?? lead?.title ?? null;
  return (
    <>
      <TvBackdrop title={shown} />
      <TvNavBar current="tonight" preferred={navPreferred} />
      <TvSpotlight title={shown} reason={spot ? spot.reason : lead?.reason}>
        {shown ? (
          <View style={styles.actions}>
            <Button
              label={spot?.progress ? "Resume" : "Play"}
              icon={Play}
              filledIcon
              size="large"
              preferred={lead !== null}
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
  fill: { flex: 1, marginTop: spacing.lg },
  content: { gap: spacing.xl, paddingBottom: TV_SAFE.y + spacing.xl },
});
