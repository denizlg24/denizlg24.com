import {
  type CastMember,
  type Episode,
  type Progress,
  type TitleDetail,
  tmdbImage,
} from "@repo/schemas/stream";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import {
  Check,
  Clapperboard,
  Film,
  Play,
  Plus,
  RotateCcw,
  UserRound,
} from "lucide-react-native";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Linking,
  type ListRenderItemInfo,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  useCurrentEpisode,
  useEpisodes,
  useSimilar,
  useTitle,
  useToggleWatchlist,
} from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { formatRemaining, progressFraction, resumePosition } from "@/lib/time";
import { colors, spacing } from "@/ui";
import { TitleLogo } from "./artwork";
import { TvBackdrop } from "./backdrop";
import { Message } from "./browse-screen";
import { FocusMemoryContext, useFocusMemoryState } from "./focus-memory";
import { FOCUS_ROOM, Focusable } from "./focusable";
import { CONTENT_X, SCREEN, TV_SAFE } from "./layout";
import { joinNames, TvMeta } from "./meta";
import { openTvTitle, playOnTv } from "./open";
import { type RowEvents, TvRow, type TvRowModel } from "./row";
import { TvButton } from "./tv-button";
import { TvText } from "./tv-text";

const LEFT = TV_SAFE.x + spacing.lg;
const EPISODE = { width: 232, height: 130 } as const;
const PERSON = { width: 112, photo: 84 } as const;
const STRIP_GAP = 16;
/** The hero leaves this much of the next section showing below it. */
const PEEK = 64;

type Section = "hero" | "episodes" | "similar" | "cast";

/**
 * The title page: full-screen backdrop, logo, facts and story, Play or
 * Resume, My List and the trailer; below, Episodes, More like this and the
 * cast. Each section snaps to the top as focus enters it.
 */
export function TvTitleScreen({ id }: { id: string }) {
  const { lead } = useAudience();
  const query = useTitle(id, lead.id);
  const memory = useFocusMemoryState();
  const scroll = useRef<ScrollView>(null);
  const tops = useRef<Partial<Record<Section, number>>>({});
  const current = useRef<Section>("hero");

  const toSection = useCallback((section: Section) => {
    if (current.current === section) return;
    current.current = section;
    const y =
      section === "hero" ? 0 : (tops.current[section] ?? 0) - spacing.lg;
    scroll.current?.scrollTo({ y: Math.max(0, y), animated: true });
  }, []);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (current.current === "hero") return false;
          toSection("hero");
          memory.restore("title:play");
          return true;
        },
      );
      const back = setTimeout(() => memory.restore(), 60);
      return () => {
        clearTimeout(back);
        subscription.remove();
      };
    }, [memory, toSection]),
  );

  const layout =
    (section: Section) =>
    (event: { nativeEvent: { layout: { y: number } } }) => {
      tops.current[section] = event.nativeEvent.layout.y;
    };

  if (!query.data) {
    return (
      <View style={styles.screen}>
        {query.isError ? (
          <Message
            title="This page didn't load"
            message="We couldn't reach Stream. Check that the TV is connected to the internet, then try again."
            action={
              <TvButton
                label="Try again"
                icon={RotateCcw}
                preferred
                loading={query.isFetching}
                onPress={() => void query.refetch()}
              />
            }
          />
        ) : (
          <ActivityIndicator
            color={colors.muted}
            size="large"
            style={styles.fill}
          />
        )}
      </View>
    );
  }

  const { title: detail } = query.data;
  const series = detail.type !== "movie" && detail.seasons.length > 0;

  return (
    <FocusMemoryContext value={memory}>
      <View style={styles.screen}>
        <TvBackdrop title={detail} fade={0.97} />
        <ScrollView
          ref={scroll}
          style={styles.fill}
          scrollEnabled={false}
          scrollsChildToFocus={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <Hero
            detail={detail}
            inWatchlist={query.data.inWatchlist}
            progress={query.data.progress}
            onFocus={() => toSection("hero")}
          />
          {series ? (
            <View onLayout={layout("episodes")}>
              <Episodes
                detail={detail}
                progress={query.data.progress}
                onFocus={() => toSection("episodes")}
              />
            </View>
          ) : null}
          <View onLayout={layout("similar")}>
            <Similar id={id} onFocus={() => toSection("similar")} />
          </View>
          {detail.cast.length > 0 ? (
            <View onLayout={layout("cast")}>
              <Cast cast={detail.cast} onFocus={() => toSection("cast")} />
            </View>
          ) : null}
        </ScrollView>
      </View>
    </FocusMemoryContext>
  );
}

function Hero({
  detail,
  inWatchlist,
  progress,
  onFocus,
}: {
  detail: TitleDetail;
  inWatchlist: boolean;
  progress: Progress | null;
  onFocus: () => void;
}) {
  const { lead } = useAudience();
  const toggle = useToggleWatchlist(lead.id);
  const current = useCurrentEpisode(detail.id, progress?.episodeId ?? null);
  const resume = resumePosition(progress);
  const episode = current.data ?? null;
  const resuming = resume !== null && progress !== null;
  const playLabel = resuming
    ? "Resume"
    : progress && detail.type !== "movie"
      ? "Continue"
      : "Play";
  const directors = detail.directors ?? [];
  const cast = detail.cast.slice(0, 3).map((person) => person.name);

  return (
    <View style={styles.hero}>
      <TitleLogo title={detail} width={400} height={104} lines={2} />
      <TvMeta title={detail} genres={3} />
      {detail.overview ? (
        <TvText variant="lede" numberOfLines={4} style={styles.overview}>
          {detail.overview}
        </TvText>
      ) : null}
      <View style={styles.credits}>
        {cast.length > 0 ? (
          <TvText variant="meta" color="muted" numberOfLines={1}>
            With {joinNames(cast)}
          </TvText>
        ) : null}
        {directors.length > 0 ? (
          <TvText variant="meta" color="muted" numberOfLines={1}>
            {detail.type === "movie" ? "Directed by" : "Created by"}{" "}
            {joinNames(directors.slice(0, 2))}
          </TvText>
        ) : null}
      </View>
      <View style={styles.buttons}>
        <TvButton
          label={playLabel}
          icon={Play}
          filledIcon
          preferred={detail.available}
          focusKey="title:play"
          disabled={!detail.available}
          onFocus={onFocus}
          onPress={() => playOnTv(detail.id, progress?.episodeId ?? null)}
        />
        <TvButton
          label="My List"
          icon={inWatchlist ? Check : Plus}
          preferred={!detail.available}
          focusKey="title:list"
          onFocus={onFocus}
          onPress={() => toggle.mutate({ title: detail, add: !inWatchlist })}
        />
        {detail.trailerKey ? (
          <TvButton
            label="Trailer"
            icon={Clapperboard}
            focusKey="title:trailer"
            next={{ right: "self" }}
            onFocus={onFocus}
            // Google TV hands YouTube links to its YouTube app.
            onPress={() =>
              void Linking.openURL(
                `https://www.youtube.com/watch?v=${detail.trailerKey}`,
              ).catch(() => undefined)
            }
          />
        ) : null}
      </View>
      {resuming && progress ? (
        <View style={styles.resume}>
          <View style={styles.track}>
            <View
              style={[
                styles.trackFill,
                {
                  width:
                    `${Math.round(progressFraction(progress.positionS, progress.durationS) * 100)}%` as const,
                },
              ]}
            />
          </View>
          <TvText variant="meta" color="muted" numberOfLines={1}>
            {episode?.season != null && episode.episode != null
              ? `Season ${episode.season}, episode ${episode.episode}  `
              : ""}
            {formatRemaining(progress.positionS, progress.durationS)}
          </TvText>
        </View>
      ) : null}
      {!detail.available ? (
        <TvText variant="body" color="muted" style={styles.note}>
          This one isn't available to play yet. Add it to My List and it will be
          waiting for you.
        </TvText>
      ) : null}
    </View>
  );
}

function Episodes({
  detail,
  progress,
  onFocus,
}: {
  detail: TitleDetail;
  progress: Progress | null;
  onFocus: () => void;
}) {
  const current = useCurrentEpisode(detail.id, progress?.episodeId ?? null);
  const [season, setSeason] = useState<number | null>(null);
  const active = season ?? current.data?.season ?? detail.seasons[0] ?? null;
  const episodes = useEpisodes(detail.id, active);

  return (
    <View style={styles.section}>
      <TvText variant="rowLabel" style={styles.sectionLabel}>
        Episodes
      </TvText>
      {detail.seasons.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.seasons}
        >
          {detail.seasons.map((number, index) => (
            <Focusable
              key={number}
              accessibilityRole="tab"
              accessibilityState={{ selected: number === active }}
              focusKey={`season:${number}`}
              next={
                index === detail.seasons.length - 1
                  ? { right: "self" }
                  : undefined
              }
              onFocus={onFocus}
              onPress={() => setSeason(number)}
              ringless
              grow={1.05}
            >
              {(focused) => (
                <View
                  style={[
                    styles.season,
                    number === active ? styles.seasonOn : null,
                    focused ? styles.seasonFocused : null,
                  ]}
                >
                  <TvText
                    variant="bodyStrong"
                    color={focused || number === active ? "ink" : "paper"}
                  >
                    Season {number}
                  </TvText>
                </View>
              )}
            </Focusable>
          ))}
        </ScrollView>
      ) : null}
      {episodes.isPending ? (
        <ActivityIndicator
          color={colors.muted}
          style={styles.episodesLoading}
        />
      ) : (episodes.data ?? []).length === 0 ? (
        <TvText variant="body" color="muted" style={styles.sectionLabel}>
          No episodes listed for this season yet.
        </TvText>
      ) : (
        <EpisodeStrip
          episodes={episodes.data ?? []}
          titleId={detail.id}
          currentId={progress?.episodeId ?? null}
          progress={progress}
          onFocus={onFocus}
        />
      )}
    </View>
  );
}

const EpisodeStrip = memo(function EpisodeStrip({
  episodes,
  titleId,
  currentId,
  progress,
  onFocus,
}: {
  episodes: Episode[];
  titleId: string;
  currentId: string | null;
  progress: Progress | null;
  onFocus: () => void;
}) {
  const strip = useStrip<Episode>(EPISODE.width + STRIP_GAP);
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Episode>) => {
      const still = tmdbImage(item.stillPath ?? null, "w780");
      const isCurrent = item.id === currentId;
      return (
        <View style={styles.episode}>
          <Focusable
            accessibilityRole="button"
            accessibilityLabel={`Episode ${item.episode ?? ""}, ${item.title ?? ""}`}
            focusKey={`episode:${item.id}`}
            next={index === episodes.length - 1 ? { right: "self" } : undefined}
            onFocus={() => {
              onFocus();
              strip.focus(index);
            }}
            onPress={() => playOnTv(titleId, item.id)}
            radius={4}
            grow={1.05}
          >
            <View style={styles.still}>
              {still ? (
                <Image
                  source={{ uri: still }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  recyclingKey={still}
                />
              ) : (
                <Film color={colors.muted} size={24} />
              )}
              {isCurrent && progress ? (
                <View style={styles.stillTrack}>
                  <View
                    style={[
                      styles.trackFill,
                      {
                        width:
                          `${Math.round(progressFraction(progress.positionS, progress.durationS) * 100)}%` as const,
                      },
                    ]}
                  />
                </View>
              ) : null}
            </View>
          </Focusable>
          <TvText
            variant="bodyStrong"
            numberOfLines={1}
            color={isCurrent ? "amber" : "paper"}
          >
            {item.episode != null ? `${item.episode}  ` : ""}
            {item.title ?? `Episode ${item.episode ?? ""}`}
          </TvText>
          <TvText variant="caption" color="muted" numberOfLines={2}>
            {[
              item.runtimeMinutes ? `${item.runtimeMinutes}m` : null,
              item.overview,
            ]
              .filter(Boolean)
              .join("  ")}
          </TvText>
        </View>
      );
    },
    [episodes.length, currentId, progress, titleId, onFocus, strip],
  );
  return (
    <FlatList
      ref={strip.ref}
      horizontal
      data={episodes}
      keyExtractor={(episode) => episode.id}
      renderItem={renderItem}
      getItemLayout={(_, i) => ({
        length: strip.stride,
        offset: strip.stride * i,
        index: i,
      })}
      scrollEnabled={false}
      scrollsChildToFocus={false}
      showsHorizontalScrollIndicator={false}
      initialNumToRender={6}
      windowSize={3}
      contentContainerStyle={styles.strip}
    />
  );
});

function Similar({ id, onFocus }: { id: string; onFocus: () => void }) {
  const { key } = useAudience();
  const similar = useSimilar(id, key);
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const model = useMemo<TvRowModel | null>(() => {
    const titles = similar.data?.titles ?? [];
    if (titles.length === 0) return null;
    return {
      id: "similar",
      label: "More like this",
      kind: "poster",
      tiles: titles.map((title) => ({ key: title.id, title })),
    };
  }, [similar.data]);
  const [events] = useState<RowEvents>(() => ({
    onTileFocus: () => {
      onFocusRef.current();
      return true;
    },
    onTilePress: (tile) => openTvTitle(tile.title.id),
  }));
  if (!model) return null;
  return (
    <View style={styles.similar}>
      <TvRow model={model} index={0} events={events} />
    </View>
  );
}

function Cast({ cast, onFocus }: { cast: CastMember[]; onFocus: () => void }) {
  const strip = useStrip<CastMember>(PERSON.width + STRIP_GAP);
  const people = cast.slice(0, 20);
  const renderItem = ({ item, index }: ListRenderItemInfo<CastMember>) => {
    const photo = tmdbImage(item.profilePath, "w185");
    return (
      <View style={styles.person}>
        <Focusable
          accessibilityRole="button"
          accessibilityLabel={`Films and series with ${item.name}`}
          focusKey={`cast:${index}`}
          next={index === people.length - 1 ? { right: "self" } : undefined}
          onFocus={() => {
            onFocus();
            strip.focus(index);
          }}
          onPress={() =>
            router.push({
              pathname: "/tv/actor/[name]",
              params: { name: item.name },
            })
          }
          radius={PERSON.photo / 2}
          grow={1.06}
        >
          <View style={styles.photo}>
            {photo ? (
              <Image
                source={{ uri: photo }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                recyclingKey={photo}
              />
            ) : (
              <UserRound color={colors.muted} size={30} />
            )}
          </View>
        </Focusable>
        <TvText
          variant="bodyStrong"
          numberOfLines={1}
          style={styles.centerText}
        >
          {item.name}
        </TvText>
        {item.character ? (
          <TvText
            variant="caption"
            color="muted"
            numberOfLines={1}
            style={styles.centerText}
          >
            {item.character}
          </TvText>
        ) : null}
      </View>
    );
  };
  return (
    <View style={styles.section}>
      <TvText variant="rowLabel" style={styles.sectionLabel}>
        Cast
      </TvText>
      <FlatList
        ref={strip.ref}
        horizontal
        data={people}
        keyExtractor={(person, index) => `${person.name}:${index}`}
        renderItem={renderItem}
        getItemLayout={(_, i) => ({
          length: strip.stride,
          offset: strip.stride * i,
          index: i,
        })}
        scrollEnabled={false}
        scrollsChildToFocus={false}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={3}
        contentContainerStyle={styles.strip}
      />
    </View>
  );
}

/** A horizontal strip that keeps the focused item at the left margin. */
function useStrip<T>(stride: number) {
  const ref = useRef<FlatList<T>>(null);
  const column = useRef(0);
  return useMemo(
    () => ({
      ref,
      stride,
      focus: (index: number) => {
        if (index === column.current) return;
        column.current = index;
        ref.current?.scrollToOffset({ offset: index * stride, animated: true });
      },
    }),
    [stride],
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  fill: { flex: 1 },
  content: { paddingBottom: SCREEN.height / 2 },
  hero: {
    minHeight: SCREEN.height - PEEK,
    paddingLeft: LEFT,
    paddingRight: TV_SAFE.x,
    paddingTop: TV_SAFE.y + spacing.xxl,
    gap: spacing.md,
    maxWidth: 620,
  },
  overview: { maxWidth: 560 },
  credits: { gap: 2 },
  buttons: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  resume: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  track: {
    width: 160,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(239,233,223,0.25)",
    overflow: "hidden",
  },
  trackFill: { height: 3, backgroundColor: colors.amber },
  note: { maxWidth: 520 },
  section: { gap: spacing.xs, paddingBottom: spacing.xl },
  sectionLabel: { paddingLeft: LEFT, paddingRight: TV_SAFE.x },
  similar: { paddingBottom: spacing.xl, marginLeft: LEFT - CONTENT_X },
  seasons: {
    paddingLeft: LEFT,
    paddingRight: TV_SAFE.x,
    paddingVertical: FOCUS_ROOM - 4,
    gap: spacing.sm,
  },
  season: {
    paddingHorizontal: spacing.lg,
    height: 34,
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: "rgba(239,233,223,0.1)",
  },
  seasonOn: { backgroundColor: colors.amber },
  seasonFocused: { backgroundColor: colors.paper },
  episodesLoading: { alignSelf: "flex-start", marginLeft: LEFT, height: 160 },
  strip: {
    paddingLeft: LEFT,
    paddingRight: TV_SAFE.x,
    paddingVertical: FOCUS_ROOM,
  },
  episode: { width: EPISODE.width, marginRight: STRIP_GAP, gap: spacing.xs },
  still: {
    width: EPISODE.width,
    height: EPISODE.height,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  stillTrack: {
    position: "absolute",
    left: spacing.sm,
    right: spacing.sm,
    bottom: 6,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(239,233,223,0.28)",
    overflow: "hidden",
  },
  person: {
    width: PERSON.width,
    marginRight: STRIP_GAP,
    alignItems: "center",
    gap: spacing.xs,
  },
  photo: {
    width: PERSON.photo,
    height: PERSON.photo,
    borderRadius: PERSON.photo / 2,
    overflow: "hidden",
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  centerText: { textAlign: "center", alignSelf: "stretch" },
});
