import type {
  Billboard,
  Browse,
  BrowseTab,
  Progress,
  TitleSummary,
} from "@repo/schemas/stream";
import { Info, Play, Popcorn, RotateCcw } from "lucide-react-native";
import {
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useBrowse } from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { launcherItems } from "@/lib/launcher";
import { createStore, type Store, useStore } from "@/lib/store";
import { formatRemaining } from "@/lib/time";
import { colors, spacing } from "@/ui";
import { publishWatching } from "../../../modules/stream-tv";
import { TitleLogo } from "./artwork";
import { TvBackdrop } from "./backdrop";
import { type FocusMemory, useFocusMemory } from "./focus-memory";
import { CONTENT_X, SCREEN, TV_SAFE } from "./layout";
import { TvMeta } from "./meta";
import { openTvTitle, playOnTv } from "./open";
import { useTitleDetail } from "./queries";
import { type RemoteKey, useRemote } from "./remote";
import {
  ROW_GAP,
  type RowEvents,
  rowHeight,
  TvRow,
  type TvRowModel,
  type TvTile,
} from "./row";
import { type TvSection, TvShell } from "./shell";
import { type Spotlight, useSpot, useSpotlight } from "./spotlight";
import { TvButton } from "./tv-button";
import { TvText } from "./tv-text";

/** Where the info block starts, and where the rows' window opens below it. */
const INFO_TOP = TV_SAFE.y + 10;
const ROWS_TOP = 250;
/** In the billboard's own state the rows sit this much lower, peeking in. */
const HERO_EXTRA = 74;
const INFO_WIDTH = 440;

const SECTION: Record<BrowseTab, TvSection> = {
  home: "home",
  series: "series",
  films: "films",
  new: "new",
};

interface Spot {
  title: TitleSummary;
  reason?: string | null;
  progress?: Progress | null;
}

export function browseRows(browse: Browse): TvRowModel[] {
  return browse.rows
    .filter((row) => row.items.length > 0)
    .map((row): TvRowModel => {
      switch (row.kind) {
        case "continue":
          return {
            id: row.id,
            label: row.label,
            kind: "continue",
            tiles: row.items.map(({ title, progress }) => ({
              key: `${row.id}:${title.id}`,
              title,
              progress,
              reason: formatRemaining(progress.positionS, progress.durationS),
            })),
          };
        case "top10":
          return {
            id: row.id,
            label: row.label,
            kind: "rank",
            tiles: row.items.map((title, index) => ({
              key: `${row.id}:${title.id}`,
              title,
              rank: index + 1,
              reason: `Number ${index + 1} in ${row.label}`,
            })),
          };
        case "titles":
          return {
            id: row.id,
            label: row.label,
            kind: row.wide ? "box" : "poster",
            tiles: row.items.map((title) => ({
              key: `${row.id}:${title.id}`,
              title,
            })),
          };
      }
    });
}

/**
 * Home, Series, Films and New & Popular: Netflix's TV layout. The top half
 * describes whatever the remote rests on; the rows sit below, and the
 * focused row always snaps to the same line, the rows above sliding away.
 */
export function TvBrowseScreen({ tab }: { tab: BrowseTab }) {
  const back = useRef<() => boolean>(() => false);
  return (
    <TvShell section={SECTION[tab]} onBack={() => back.current()}>
      <BrowseContent tab={tab} back={back} />
    </TvShell>
  );
}

function BrowseContent({
  tab,
  back,
}: {
  tab: BrowseTab;
  back: { current: () => boolean };
}) {
  const { key } = useAudience();
  const browse = useBrowse(key, tab);
  const memory = useFocusMemory();
  const spotlight = useSpotlight<Spot>();
  const vertical = useRef<ScrollView>(null);
  const billboard = browse.data?.billboard ?? null;
  const rows = useMemo(
    () => (browse.data ? browseRows(browse.data) : []),
    [browse.data],
  );
  const [controller] = useState(() =>
    createController(vertical, spotlight, memory),
  );
  useEffect(() => {
    const items = browse.data ? launcherItems(browse.data) : null;
    if (items) publishWatching(items);
  }, [browse.data]);
  controller.setRows(rows);
  controller.setBillboard(billboard);
  back.current = controller.back;
  useRemote(controller.move);

  if (browse.isPending) return <Loading />;
  if (browse.isError && !browse.data) {
    return (
      <Message
        title="This didn't load"
        message="We couldn't reach Stream. Check that the TV is connected to the internet, then try again."
        action={
          <TvButton
            label="Try again"
            icon={RotateCcw}
            preferred
            loading={browse.isFetching}
            onPress={() => void browse.refetch()}
          />
        }
      />
    );
  }
  if (rows.length === 0 && !billboard) {
    return (
      <Message
        title="Nothing here yet"
        message="Films and series are still being added. Please check back a little later."
      />
    );
  }

  return (
    <View style={styles.fill}>
      <SpotBackdrop spotlight={spotlight} billboard={billboard} />
      <SpotInfo spotlight={spotlight} billboard={billboard} />
      {billboard ? (
        <BillboardButtons
          billboard={billboard}
          rowStore={controller.rowStore}
          onFocus={controller.enterBillboard}
        />
      ) : null}
      <ScrollView
        ref={vertical}
        style={styles.rows}
        contentContainerStyle={styles.rowsContent}
        scrollEnabled={false}
        scrollsChildToFocus={false}
        showsVerticalScrollIndicator={false}
      >
        <Rows
          rows={rows}
          events={controller.events}
          preferFirst={billboard === null}
        />
      </ScrollView>
    </View>
  );
}

const Rows = memo(function Rows({
  rows,
  events,
  preferFirst,
}: {
  rows: TvRowModel[];
  events: RowEvents;
  preferFirst: boolean;
}) {
  return rows.map((row, index) => (
    <TvRow
      key={row.id}
      model={row}
      index={index}
      events={events}
      holdVertical
      preferFirst={preferFirst && index === 0}
    />
  ));
});

interface Controller {
  rowStore: Store<number>;
  /** Up or down from a tile: the next row's remembered column, or the billboard. */
  move: (key: RemoteKey) => void;
  events: RowEvents;
  enterBillboard: () => void;
  back: () => boolean;
  setRows: (rows: TvRowModel[]) => void;
  setBillboard: (billboard: Billboard | null) => void;
}

/**
 * The browse screen's focus logic, outside React: which row has focus
 * (`rowStore`, read only by the billboard buttons), the column each row was
 * left on, and the vertical snap. Rows get `events` once and never again.
 */
function createController(
  vertical: { current: ScrollView | null },
  spotlight: Spotlight<Spot>,
  memory: FocusMemory | null,
): Controller {
  const rowStore = createStore(-1);
  const columns = new Map<string, number>();
  let rows: TvRowModel[] = [];
  let tops: number[] = [];
  let billboard: Billboard | null = null;
  let onTile = false;

  const focusRow = (index: number) => {
    const target = rows[index];
    if (!target) return;
    const column = Math.min(
      columns.get(target.id) ?? 0,
      target.tiles.length - 1,
    );
    memory?.restore(`${target.id}:${Math.max(0, column)}`);
  };

  const toRow = (index: number) => {
    if (rowStore.get() === index) return;
    rowStore.set(index);
    const y = index < 0 ? 0 : HERO_EXTRA + (tops[index] ?? 0);
    vertical.current?.scrollTo({ y, animated: true });
  };

  const enterBillboard = () => {
    toRow(-1);
    if (billboard) {
      spotlight.set({
        title: billboard.title,
        reason: billboard.reason,
        progress: billboard.progress,
      });
    }
  };

  return {
    rowStore,
    enterBillboard,
    move: (key) => {
      if (!onTile || (key !== "up" && key !== "down")) return;
      const row = rowStore.get();
      if (key === "down") {
        focusRow(row + 1);
        return;
      }
      if (row > 0) {
        focusRow(row - 1);
        return;
      }
      if (row === 0 && billboard) {
        enterBillboard();
        memory?.restore(
          billboard.title.available ? "billboard:play" : "billboard:info",
        );
      }
    },
    setRows: (next) => {
      if (next === rows) return;
      rows = next;
      let y = 0;
      tops = next.map((row) => {
        const top = y;
        y += rowHeight(row.kind) + ROW_GAP;
        return top;
      });
    },
    setBillboard: (next) => {
      billboard = next;
    },
    back: () => {
      const row = rowStore.get();
      if (row < 0) return false;
      if (billboard) {
        enterBillboard();
        memory?.restore(
          billboard.title.available ? "billboard:play" : "billboard:info",
        );
        return true;
      }
      const first = rows[0];
      if (row === 0 || !first) return false;
      memory?.restore(`${first.id}:${columns.get(first.id) ?? 0}`);
      return true;
    },
    events: {
      onTileBlur: () => {
        onTile = false;
      },
      onTileFocus: (index, model, column) => {
        onTile = true;
        const entering = rowStore.get() !== index;
        const remembered = columns.get(model.id);
        toRow(index);
        if (
          entering &&
          remembered !== undefined &&
          remembered !== column &&
          remembered < model.tiles.length
        ) {
          memory?.restore(`${model.id}:${remembered}`);
          return false;
        }
        columns.set(model.id, column);
        const tile = model.tiles[column];
        if (tile) {
          spotlight.set({
            title: tile.title,
            reason: tile.reason,
            progress: tile.progress,
          });
        }
        return true;
      },
      onTilePress: (tile: TvTile) => {
        if (tile.progress) playOnTv(tile.title.id, tile.progress.episodeId);
        else openTvTitle(tile.title.id);
      },
    },
  };
}

function SpotBackdrop({
  spotlight,
  billboard,
}: {
  spotlight: Spotlight<Spot>;
  billboard: Billboard | null;
}) {
  const spot = useSpot(spotlight);
  return <TvBackdrop title={spot?.title ?? billboard?.title ?? null} />;
}

/**
 * Logo, facts, three lines of story and a reason for whatever has focus. A
 * row only carries summaries, so the overview comes from the title itself
 * (cached, and the title page opens from the same cache).
 */
function SpotInfo({
  spotlight,
  billboard,
}: {
  spotlight: Spotlight<Spot>;
  billboard: Billboard | null;
}) {
  const { lead } = useAudience();
  const spot = useSpot(spotlight);
  const fromBillboard = !spot || spot.title.id === billboard?.title.id;
  const title = spot?.title ?? billboard?.title ?? null;
  const detail = useTitleDetail(
    fromBillboard ? null : (title?.id ?? null),
    lead.id,
  );
  if (!title) return null;
  const full =
    fromBillboard && billboard
      ? billboard.title
      : detail.data?.title.id === title.id
        ? detail.data.title
        : null;
  const overview = full?.overview ?? null;
  const reason = spot ? spot.reason : billboard?.reason;
  return (
    <View style={styles.info} pointerEvents="none">
      <TitleLogo title={full ?? title} width={320} height={78} lines={2} />
      <TvMeta title={full ?? title} />
      <TvText variant="body" numberOfLines={3} style={styles.overview}>
        {overview ?? ""}
      </TvText>
      {reason ? (
        <TvText variant="bodyStrong" color="amber" numberOfLines={1}>
          {reason}
        </TvText>
      ) : null}
    </View>
  );
}

function BillboardButtons({
  billboard,
  rowStore,
  onFocus,
}: {
  billboard: Billboard;
  rowStore: Store<number>;
  onFocus: () => void;
}) {
  const row = useStore(rowStore);
  const shown = useSharedValue(1);
  useEffect(() => {
    shown.value = withTiming(row < 0 ? 1 : 0, { duration: 160 });
  }, [row, shown]);
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));
  const { title, progress } = billboard;
  const resuming = progress !== null && !progress.completed;
  return (
    <Animated.View style={[styles.buttons, fade]}>
      <TvButton
        label={resuming ? "Resume" : "Play"}
        icon={Play}
        filledIcon
        preferred={title.available}
        focusKey="billboard:play"
        focusable={row <= 0}
        disabled={!title.available}
        onFocus={onFocus}
        onPress={() => playOnTv(title.id, progress?.episodeId ?? null)}
      />
      <TvButton
        label="More info"
        icon={Info}
        focusKey="billboard:info"
        preferred={!title.available}
        focusable={row <= 0}
        next={{ right: "self" }}
        onFocus={onFocus}
        onPress={() => openTvTitle(title.id)}
      />
    </Animated.View>
  );
}

function Loading() {
  return (
    <View style={styles.fill}>
      <View style={[styles.info, styles.skeletonInfo]}>
        <View style={[styles.bone, { width: 280, height: 56 }]} />
        <View style={[styles.bone, { width: 220, height: 16 }]} />
        <View style={[styles.bone, { width: 400, height: 54 }]} />
      </View>
      <View style={[styles.rows, styles.skeletonRows]}>
        {[0, 1].map((row) => (
          <View key={row} style={styles.skeletonRow}>
            <View style={[styles.bone, { width: 160, height: 16 }]} />
            <View style={styles.skeletonTiles}>
              {[0, 1, 2, 3, 4, 5, 6].map((tile) => (
                <View key={tile} style={[styles.bone, styles.skeletonTile]} />
              ))}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function Message({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.message}>
      <Popcorn color={colors.muted} size={40} strokeWidth={1.4} />
      <TvText variant="heading" style={styles.center}>
        {title}
      </TvText>
      <TvText variant="lede" color="muted" style={[styles.center, styles.copy]}>
        {message}
      </TvText>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.ink },
  info: {
    position: "absolute",
    left: CONTENT_X,
    top: INFO_TOP,
    width: INFO_WIDTH,
    gap: spacing.sm,
  },
  overview: { height: 63 },
  buttons: {
    position: "absolute",
    left: CONTENT_X,
    top: ROWS_TOP + 6,
    flexDirection: "row",
    gap: spacing.md,
  },
  rows: {
    position: "absolute",
    top: ROWS_TOP,
    left: 0,
    right: 0,
    bottom: 0,
  },
  rowsContent: {
    paddingTop: HERO_EXTRA,
    paddingBottom: SCREEN.height,
    gap: ROW_GAP,
  },
  skeletonInfo: { gap: spacing.md },
  skeletonRows: { paddingTop: HERO_EXTRA, gap: spacing.xxl },
  skeletonRow: { paddingLeft: CONTENT_X, gap: spacing.md },
  skeletonTiles: { flexDirection: "row", gap: 14, overflow: "hidden" },
  skeletonTile: { width: 112, height: 168 },
  bone: { backgroundColor: colors.raised, borderRadius: 4 },
  message: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingLeft: CONTENT_X,
    paddingRight: TV_SAFE.x,
  },
  center: { textAlign: "center" },
  copy: { maxWidth: 520 },
  action: { marginTop: spacing.md },
});
