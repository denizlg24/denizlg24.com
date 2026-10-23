import type {
  ContinueWatchingItem,
  Recommendation,
  TitleSummary,
  Tonight,
} from "@repo/schemas/stream";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Clock,
  Info,
  Moon,
  Play,
  Users,
} from "lucide-react-native";
import { useEffect } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useTitle, useToggleWatchlist, useTonight } from "@/api/stream";
import { openTitle, playTitle } from "@/features/studio/open";
import { StudioHeader } from "@/features/studio/studio-header";
import { audienceNames, editionDate } from "@/lib/audience";
import { useAudience } from "@/lib/audience-store";
import { combinedRuntime, titleFacts } from "@/lib/format";
import { formatRemaining, progressFraction } from "@/lib/time";
import {
  Backdrop,
  Button,
  colors,
  EmptyState,
  gutter,
  MetaRow,
  Poster,
  Rating,
  Skeleton,
  Still,
  spacing,
  Text,
} from "@/ui";

/** Today's programme for whoever is on the sofa: a finite page, not a feed. */
export function TonightScreen() {
  const { key } = useAudience();
  const tonight = useTonight(key);
  const data = tonight.data;
  const empty =
    data &&
    !data.lead &&
    data.programme.length === 0 &&
    data.continue.length === 0;

  return (
    <View style={styles.screen}>
      <StudioHeader floating={!!data?.lead} />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={tonight.isRefetching}
            onRefresh={() => void tonight.refetch()}
            tintColor={colors.muted}
          />
        }
      >
        {tonight.isPending ? <TonightSkeleton /> : null}
        {tonight.isError && !data ? (
          <EmptyState
            icon={Moon}
            title="Tonight's programme didn't arrive"
            message="We couldn't reach Stream. Check your connection, then pull down to try again."
            action={
              <Button
                label="Try again"
                onPress={() => void tonight.refetch()}
              />
            }
          />
        ) : null}
        {empty ? (
          <EmptyState
            icon={Moon}
            title="Nothing on tonight yet"
            message="The catalogue is still being filled in. Have a wander on the Map or turn the dials in Tune. Tonight's picks will appear here as soon as there's enough to choose from."
          />
        ) : null}
        {data?.lead ? <Lead lead={data.lead} audience={data.audience} /> : null}
        {data && data.continue.length > 0 ? (
          <PickUp items={data.continue} />
        ) : null}
        {data && data.programme.length > 0 ? (
          <AlsoTonight items={data.programme} date={data.date} />
        ) : null}
        {data?.doubleFeature ? (
          <DoubleFeature feature={data.doubleFeature} />
        ) : null}
        {data && data.fresh.length > 0 ? (
          <NewThisYear items={data.fresh} />
        ) : null}
        {data && !empty ? (
          <View style={styles.footer}>
            <Text variant="body" color="muted" style={styles.center}>
              A new programme arrives tomorrow.
            </Text>
            <Text variant="caption" color="faint" style={styles.center}>
              Film and series data from TMDB. This product uses the TMDB API but
              is not endorsed or certified by TMDB.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Lead({
  lead,
  audience,
}: {
  lead: NonNullable<Tonight["lead"]>;
  audience: Tonight["audience"];
}) {
  const { width } = useWindowDimensions();
  const { lead: profile, audience: seated } = useAudience();
  const detail = useTitle(lead.title.id, profile.id);
  const toggle = useToggleWatchlist(profile.id);
  const saved = detail.data?.inWatchlist ?? false;
  const reduced = useReducedMotion();
  const zoom = useSharedValue(1);

  useEffect(() => {
    if (reduced) return;
    zoom.value = withRepeat(
      withTiming(1.09, { duration: 22_000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [reduced, zoom]);
  const kenBurns = useAnimatedStyle(() => ({
    transform: [{ scale: zoom.value }],
  }));
  const who = audienceNames(audience.length > 0 ? audience : seated);

  return (
    <View>
      <View style={{ height: Math.max(460, width * 1.15) }}>
        <Animated.View style={[StyleSheet.absoluteFill, kenBurns]}>
          <Backdrop title={lead.title} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <LinearGradient
          pointerEvents="none"
          colors={[
            "rgba(12,11,10,0.85)",
            "rgba(12,11,10,0.2)",
            "rgba(12,11,10,0)",
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(12,11,10,0.65)", "rgba(12,11,10,0)", colors.ink]}
          locations={[0, 0.3, 1]}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View entering={FadeIn.duration(600)} style={styles.leadTitle}>
          <Text variant="marquee" numberOfLines={3} adjustsFontSizeToFit>
            {lead.title.title}
          </Text>
        </Animated.View>
      </View>
      <View style={styles.leadBody}>
        <MetaRow facts={titleFacts(lead.title)} />
        <Text variant="lede">{lead.reason}</Text>
        <View style={styles.leadActions}>
          <Button
            label="Play"
            icon={Play}
            filledIcon
            size="large"
            onPress={() => playTitle(lead.title.id)}
          />
          <Button
            label="Details"
            icon={Info}
            variant="secondary"
            size="large"
            onPress={() => openTitle(lead.title.id)}
          />
          <Button
            label={saved ? "Saved" : "Save"}
            icon={saved ? BookmarkCheck : Bookmark}
            variant="ghost"
            size="large"
            onPress={() => toggle.mutate({ title: lead.title, add: !saved })}
          />
        </View>
        {who ? (
          <View style={styles.chosen}>
            <Users color={colors.muted} size={15} />
            <Text variant="footnote" color="muted">
              Chosen for {who}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  /** Set to the right of the heading, e.g. the date. */
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text variant="display" style={styles.grow} accessibilityRole="header">
          {title}
        </Text>
        {aside ? (
          <Text variant="footnote" color="muted">
            {aside}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function PickUp({ items }: { items: ContinueWatchingItem[] }) {
  return (
    <Section title="Pick up where you left off">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {items.map(({ title, progress }) => {
          const left = formatRemaining(progress.positionS, progress.durationS);
          return (
            <Pressable
              key={title.id}
              accessibilityRole="button"
              accessibilityLabel={`${title.title}, ${left}`}
              onPress={() => playTitle(title.id, progress.episodeId)}
              style={({ pressed }) => [
                styles.stripItem,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Still
                title={title}
                width={220}
                progress={progressFraction(
                  progress.positionS,
                  progress.durationS,
                )}
              />
              <Text variant="headline" numberOfLines={1}>
                {title.title}
              </Text>
              <Text variant="footnote" color="muted">
                {left}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Section>
  );
}

/** A still with the name set on it over a bottom gradient, rating and year beneath the name. */
function TitledStill({ title, width }: { title: TitleSummary; width: number }) {
  return (
    <Still title={title} width={width}>
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(12,11,10,0)", "rgba(12,11,10,0.88)"]}
        locations={[0.35, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.stillCopy}>
        <Text variant="title" numberOfLines={2}>
          {title.title}
        </Text>
        <View style={styles.stillMeta}>
          {title.rating !== null ? (
            <Rating value={title.rating.toFixed(1)} />
          ) : null}
          {title.startYear ? (
            <Text variant="subheadline" color="muted">
              {title.startYear}
            </Text>
          ) : null}
        </View>
      </View>
    </Still>
  );
}

function AlsoTonight({
  items,
  date,
}: {
  items: Recommendation[];
  date: string;
}) {
  const { width } = useWindowDimensions();
  return (
    <Section title="Also tonight" aside={editionDate(date)}>
      <View style={styles.list}>
        {items.map((item) => (
          <Pressable
            key={item.title.id}
            accessibilityRole="button"
            accessibilityLabel={`${item.title.title}. ${item.reason}`}
            onPress={() => openTitle(item.title.id)}
            style={({ pressed }) => [
              styles.pick,
              { opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <TitledStill title={item.title} width={width - gutter * 2} />
            <Text variant="body" color="muted">
              {item.reason}
            </Text>
          </Pressable>
        ))}
      </View>
    </Section>
  );
}

function DoubleFeature({
  feature,
}: {
  feature: NonNullable<Tonight["doubleFeature"]>;
}) {
  const { width } = useWindowDimensions();
  const half = (width - gutter * 2 - spacing.md) / 2;
  const together = combinedRuntime(
    feature.first.runtimeMinutes,
    feature.second.runtimeMinutes,
  );
  const tile = (title: TitleSummary) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title.title}
      onPress={() => openTitle(title.id)}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <TitledStill title={title} width={half} />
    </Pressable>
  );
  return (
    <Section title="Double feature">
      <View style={styles.pad}>
        <View style={styles.feature}>
          {tile(feature.first)}
          {tile(feature.second)}
          <View pointerEvents="none" style={styles.joint}>
            <ArrowRight color={colors.onAmber} size={18} strokeWidth={2.4} />
          </View>
        </View>
        <View style={styles.featureCopy}>
          {together ? (
            <View style={styles.chosen}>
              <Clock color={colors.muted} size={15} />
              <Text variant="footnote" color="muted">
                {together}
              </Text>
            </View>
          ) : null}
          <Text variant="body" color="muted">
            {feature.reason}
          </Text>
        </View>
      </View>
    </Section>
  );
}

function NewThisYear({ items }: { items: TitleSummary[] }) {
  return (
    <Section title="New this year">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {items.map((title) => (
          <Pressable
            key={title.id}
            accessibilityRole="button"
            accessibilityLabel={title.title}
            onPress={() => openTitle(title.id)}
            style={({ pressed }) => [
              styles.small,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Poster title={title} width={104} />
            <Text variant="footnote" numberOfLines={1}>
              {title.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </Section>
  );
}

function TonightSkeleton() {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.skeleton}>
      <Skeleton style={{ height: width * 1.1, borderRadius: 0 }} />
      <View style={[styles.pad, styles.skeletonLines]}>
        <Skeleton style={{ height: 36, width: "70%" }} />
        <Skeleton style={{ height: 16, width: "50%" }} />
        <Skeleton style={{ height: 16, width: "85%" }} />
      </View>
    </View>
  );
}

const JOINT = 36;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { paddingBottom: 140 },
  pad: { paddingHorizontal: gutter },
  grow: { flex: 1 },
  center: { textAlign: "center" },
  leadTitle: {
    position: "absolute",
    left: gutter,
    right: gutter,
    bottom: spacing.lg,
  },
  leadBody: { paddingHorizontal: gutter, gap: spacing.lg },
  leadActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chosen: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  section: { marginTop: spacing.xxxl + spacing.md, gap: spacing.lg },
  heading: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.md,
    paddingHorizontal: gutter,
  },
  strip: { paddingHorizontal: gutter, gap: spacing.md },
  stripItem: { width: 220, gap: spacing.xs },
  list: { paddingHorizontal: gutter, gap: spacing.xxl },
  pick: { gap: spacing.sm },
  stillCopy: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    gap: spacing.xs,
  },
  stillMeta: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  feature: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  joint: {
    position: "absolute",
    left: "50%",
    marginLeft: -JOINT / 2,
    width: JOINT,
    height: JOINT,
    borderRadius: JOINT / 2,
    backgroundColor: colors.amber,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: colors.ink,
  },
  featureCopy: { gap: spacing.sm, marginTop: spacing.md },
  small: { width: 104, gap: spacing.xs },
  footer: {
    marginTop: spacing.xxxl * 1.5,
    paddingHorizontal: gutter,
    gap: spacing.sm,
  },
  skeleton: { gap: spacing.xl },
  skeletonLines: { gap: spacing.md },
});
