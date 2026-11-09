import type { TitleDetail } from "@repo/schemas/stream";
import { router } from "expo-router";
import {
  Check,
  ChevronLeft,
  Clapperboard,
  CloudOff,
  Play,
  Plus,
} from "lucide-react-native";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentEpisode, useTitle, useToggleWatchlist } from "@/api/stream";
import { EDGE } from "@/features/browse/metrics";
import { TitleLogo } from "@/features/browse/rows";
import { useAudience } from "@/lib/audience-store";
import { listNames } from "@/lib/format";
import { formatRemaining, progressFraction, resumePosition } from "@/lib/time";
import {
  Backdrop,
  Button,
  colors,
  EmptyState,
  IconButton,
  ProgressLine,
  Skeleton,
  StackedAction,
  spacing,
  Text,
} from "@/ui";
import { Episodes } from "./episodes";
import { FactsRow } from "./facts-row";
import { MoreLikeThis } from "./more-like-this";
import { openTitle, openTrailer, playTitle } from "./open";

type Tab = "episodes" | "similar" | "trailers";

/**
 * A title's page, as on Netflix's phone app: the picture (the trailer when
 * there is one), logo, facts, Play, My List, the overview and credits, then
 * Episodes, More like this and Trailers.
 */
export function TitleScreen({ id }: { id: string }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { lead } = useAudience();
  const query = useTitle(id, lead.id);
  const toggle = useToggleWatchlist(lead.id);
  const detail = query.data?.title;
  const current = useCurrentEpisode(
    id,
    detail && detail.type !== "movie"
      ? (query.data?.progress?.episodeId ?? null)
      : null,
  );
  const [tab, setTab] = useState<Tab | null>(null);
  const pictureHeight = Math.round((width * 9) / 16);

  const back = (
    <View style={[styles.back, { top: insets.top + spacing.xs }]}>
      <IconButton
        icon={ChevronLeft}
        label="Back"
        scrim
        onPress={() => router.back()}
      />
    </View>
  );

  if (!detail || !query.data) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {query.isError ? (
          <View style={styles.center}>
            <EmptyState
              icon={CloudOff}
              title="This page didn't load"
              message="We couldn't reach Stream. Check your connection and try again."
              action={
                <Button
                  label="Try again"
                  onPress={() => void query.refetch()}
                />
              }
            />
          </View>
        ) : (
          <TitleSkeleton width={width} pictureHeight={pictureHeight} />
        )}
        {back}
      </View>
    );
  }

  const { inWatchlist, progress } = query.data;
  const series = detail.type !== "movie";
  const tabs: Tab[] = [
    ...(series && detail.seasons.length > 0 ? (["episodes"] as const) : []),
    "similar",
    ...(detail.trailerKey ? (["trailers"] as const) : []),
  ];
  const activeTab = tab && tabs.includes(tab) ? tab : (tabs[0] ?? "similar");
  const resume = resumePosition(progress);
  const episode = current.data;
  const playLabel =
    resume !== null
      ? episode && episode.season !== null && episode.episode !== null
        ? `Resume S${episode.season} E${episode.episode}`
        : "Resume"
      : progress &&
          series &&
          episode &&
          episode.season !== null &&
          episode.episode !== null
        ? `Play S${episode.season} E${episode.episode}`
        : "Play";

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + spacing.xxxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Picture detail={detail} width={width} height={pictureHeight} />
        <Animated.View entering={FadeIn.duration(300)} style={styles.body}>
          <TitleLogo
            title={detail}
            maxWidth={width * 0.72}
            height={Math.round(width * 0.17)}
            variant="hero"
          />
          <FactsRow detail={detail} />

          <View style={styles.play}>
            <Button
              label={playLabel}
              icon={Play}
              filledIcon
              size="large"
              rounded
              block
              disabled={!detail.available}
              onPress={() => playTitle(id, progress?.episodeId)}
            />
            {resume !== null && progress ? (
              <View style={styles.resume}>
                <ProgressLine
                  value={progressFraction(
                    progress.positionS,
                    progress.durationS,
                  )}
                  style={styles.grow}
                />
                <Text variant="caption" color="muted" numberOfLines={1}>
                  {formatRemaining(progress.positionS, progress.durationS)}
                </Text>
              </View>
            ) : null}
            {!detail.available ? (
              <Text variant="footnote" color="muted">
                This isn't ready to play yet. Add it to My List and come back
                later.
              </Text>
            ) : null}
          </View>

          <Overview text={detail.overview ?? detail.tagline} />
          <Credits detail={detail} />

          <View style={styles.actions}>
            <StackedAction
              icon={inWatchlist ? Check : Plus}
              label="My List"
              active={inWatchlist}
              onPress={() =>
                toggle.mutate({ title: detail, add: !inWatchlist })
              }
            />
            {detail.trailerKey ? (
              <StackedAction
                icon={Clapperboard}
                label="Trailer"
                onPress={() =>
                  detail.trailerKey && openTrailer(detail.trailerKey)
                }
              />
            ) : null}
          </View>
        </Animated.View>

        <TabStrip tabs={tabs} active={activeTab} onChange={setTab} />
        <View style={styles.tabBody}>
          {activeTab === "episodes" ? (
            <Episodes
              detail={detail}
              progress={progress}
              initialSeason={episode?.season ?? null}
            />
          ) : activeTab === "trailers" && detail.trailerKey ? (
            <Trailer detail={detail} width={width - EDGE * 2} />
          ) : (
            <MoreLikeThis id={id} onOpen={openTitle} />
          )}
        </View>
      </ScrollView>
      {back}
    </View>
  );
}

/** The backdrop; with a trailer, tapping it plays the trailer. */
function Picture({
  detail,
  width,
  height,
}: {
  detail: TitleDetail;
  width: number;
  height: number;
}) {
  const key = detail.trailerKey;
  const picture = <Backdrop title={detail} style={{ width, height }} />;
  if (!key) return picture;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play the trailer for ${detail.title}`}
      onPress={() => openTrailer(key)}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {picture}
      <View style={styles.trailerBadge} pointerEvents="none">
        <Play color={colors.paper} fill={colors.paper} size={14} />
        <Text variant="caption" numberOfLines={1}>
          Trailer
        </Text>
      </View>
    </Pressable>
  );
}

function Overview({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open ? "Show less" : "Show the whole description"}
      onPress={() => setOpen((value) => !value)}
    >
      <Text variant="subheadline" numberOfLines={open ? undefined : 3}>
        {text}
      </Text>
    </Pressable>
  );
}

/** "Starring" and "Director" lines; tapping Starring lists the cast, each opening their films. */
function Credits({ detail }: { detail: TitleDetail }) {
  const [open, setOpen] = useState(false);
  const cast = detail.cast.map((member) => member.name);
  const directors = detail.directors ?? [];
  return (
    <View style={styles.credits}>
      {cast.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? "Hide the cast" : "Show the whole cast"}
          onPress={() => setOpen((value) => !value)}
        >
          <Text
            variant="footnote"
            color="muted"
            numberOfLines={open ? undefined : 1}
          >
            Starring: {listNames(cast.slice(0, open ? cast.length : 4))}
          </Text>
        </Pressable>
      ) : null}
      {open ? (
        <View style={styles.cast}>
          {detail.cast.map((member) => (
            <Pressable
              key={`${member.name}:${member.character ?? ""}`}
              accessibilityRole="button"
              accessibilityLabel={`Films and series with ${member.name}`}
              onPress={() =>
                router.push({
                  pathname: "/actor/[name]",
                  params: { name: member.name },
                })
              }
              style={({ pressed }) => [
                styles.castRow,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text variant="callout" numberOfLines={1} style={styles.grow}>
                {member.name}
              </Text>
              {member.character ? (
                <Text
                  variant="footnote"
                  color="muted"
                  numberOfLines={1}
                  style={styles.character}
                >
                  {member.character}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {directors.length > 0 ? (
        <Text variant="footnote" color="muted" numberOfLines={1}>
          {detail.type === "movie"
            ? directors.length > 1
              ? "Directors"
              : "Director"
            : directors.length > 1
              ? "Creators"
              : "Creator"}
          : {listNames(directors)}
        </Text>
      ) : null}
    </View>
  );
}

const TAB_LABELS: Record<Tab, string> = {
  episodes: "Episodes",
  similar: "More like this",
  trailers: "Trailers",
};

/** Netflix's tabs: an amber bar over the chosen one. */
function TabStrip({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab[];
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const on = tab === active;
        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={TAB_LABELS[tab]}
            onPress={() => onChange(tab)}
            style={styles.tab}
          >
            <View style={[styles.tabBar, on ? styles.tabBarOn : null]} />
            <Text
              variant="callout"
              color={on ? "paper" : "muted"}
              numberOfLines={1}
            >
              {TAB_LABELS[tab]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Trailer({ detail, width }: { detail: TitleDetail; width: number }) {
  const key = detail.trailerKey;
  if (!key) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play the trailer for ${detail.title}`}
      onPress={() => openTrailer(key)}
      style={({ pressed }) => [styles.trailer, { opacity: pressed ? 0.8 : 1 }]}
    >
      <Backdrop
        title={detail}
        style={{ width, height: (width * 9) / 16, borderRadius: 6 }}
      >
        <View style={styles.trailerPlay}>
          <View style={styles.trailerDisc}>
            <Play color={colors.paper} fill={colors.paper} size={22} />
          </View>
        </View>
      </Backdrop>
      <Text variant="callout" numberOfLines={1}>
        Official trailer
      </Text>
    </Pressable>
  );
}

function TitleSkeleton({
  width,
  pictureHeight,
}: {
  width: number;
  pictureHeight: number;
}) {
  return (
    <View style={styles.skeleton}>
      <Skeleton style={{ width, height: pictureHeight, borderRadius: 0 }} />
      <View style={styles.body}>
        <Skeleton style={{ width: width * 0.6, height: 40 }} />
        <Skeleton style={{ width: width * 0.5, height: 16 }} />
        <Skeleton
          style={{ width: width - EDGE * 2, height: 52, borderRadius: 6 }}
        />
        <Skeleton style={{ width: width - EDGE * 2, height: 60 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  back: { position: "absolute", left: spacing.sm },
  body: { paddingHorizontal: EDGE, paddingTop: spacing.lg, gap: spacing.md },
  play: { gap: spacing.sm },
  resume: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  credits: { gap: spacing.xs },
  cast: { gap: 0 },
  castRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  character: { flexShrink: 1, maxWidth: "50%", textAlign: "right" },
  actions: { flexDirection: "row", gap: spacing.md, marginLeft: -spacing.sm },
  trailerBadge: {
    position: "absolute",
    left: spacing.md,
    bottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: "rgba(12,11,10,0.6)",
  },
  tabs: {
    flexDirection: "row",
    gap: spacing.xl,
    marginTop: spacing.xl,
    paddingHorizontal: EDGE,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  tab: { paddingBottom: spacing.md, gap: spacing.md, flexShrink: 1 },
  tabBar: { height: 4, backgroundColor: "transparent" },
  tabBarOn: { backgroundColor: colors.amber },
  tabBody: { paddingHorizontal: EDGE, paddingTop: spacing.sm },
  trailer: { gap: spacing.sm },
  trailerPlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  trailerDisc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: colors.paper,
    backgroundColor: "rgba(12,11,10,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 3,
  },
  skeleton: { gap: 0 },
});
