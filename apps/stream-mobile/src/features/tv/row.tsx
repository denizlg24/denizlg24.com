import type { Progress, TitleSummary } from "@repo/schemas/stream";
import { memo, useCallback, useRef } from "react";
import {
  FlatList,
  type ListRenderItemInfo,
  StyleSheet,
  View,
} from "react-native";
import Svg, { Text as SvgText } from "react-native-svg";
import { progressFraction } from "@/lib/time";
import { colors, fonts } from "@/ui";
import { FocusRow } from "../../../modules/stream-tv";
import { BoxArt, PosterArt } from "./artwork";
import { FOCUS_ROOM, Focusable } from "./focusable";
import {
  BOX,
  CONTENT_X,
  POSTER,
  RANK_WIDTH,
  ROW_LABEL,
  SCREEN,
  TILE_GAP,
  TV_SAFE,
} from "./layout";
import { TvText } from "./tv-text";

export type RowKind = "poster" | "box" | "rank" | "continue";

export interface TvTile {
  key: string;
  title: TitleSummary;
  /** Continue watching. */
  progress?: Progress;
  /** Top 10, from 1. */
  rank?: number;
  /** A line for the billboard while this tile has focus. */
  reason?: string | null;
}

export interface TvRowModel {
  id: string;
  label: string;
  kind: RowKind;
  tiles: TvTile[];
}

export const ROW_GAP = 6;

export function tileSize(kind: RowKind): { width: number; height: number } {
  switch (kind) {
    case "poster":
      return POSTER;
    case "rank":
      return { width: RANK_WIDTH + POSTER.width, height: POSTER.height };
    case "box":
    case "continue":
      return BOX;
  }
}

/** A row's full height: its label, the tiles, and the room a lifted tile needs. */
export function rowHeight(kind: RowKind): number {
  return ROW_LABEL + FOCUS_ROOM * 2 + tileSize(kind).height;
}

/**
 * What a row tells the screen. Stable for the screen's life, so rows are
 * memoised once and never re-render when focus moves.
 */
export interface RowEvents {
  onTileFocus: (row: number, model: TvRowModel, column: number) => void;
  onTilePress: (tile: TvTile) => void;
}

/**
 * One row: a label over a horizontal strip that keeps the focused tile at
 * the content's left edge. Native scrolling is off (`scrollEnabled`,
 * `scrollsChildToFocus`), so only this row's own animated scroll moves it.
 * The row is a native `FocusRow`: Up or Down from a neighbouring row lands
 * on the tile this one last held, decided by Android in the same frame.
 */
export const TvRow = memo(function TvRow({
  model,
  index,
  events,
  preferFirst = false,
  initialColumn = 0,
}: {
  model: TvRowModel;
  index: number;
  events: RowEvents;
  preferFirst?: boolean;
  initialColumn?: number;
}) {
  const list = useRef<FlatList<TvTile>>(null);
  const size = tileSize(model.kind);
  const stride = size.width + TILE_GAP;
  const initial = useRef(initialColumn).current;
  const column = useRef(initial);

  const focusColumn = useCallback(
    (col: number) => {
      events.onTileFocus(index, model, col);
      if (col === column.current) return;
      column.current = col;
      list.current?.scrollToOffset({ offset: col * stride, animated: true });
    },
    [events, index, model, stride],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<TvTile> | null | undefined, i: number) => ({
      length: stride,
      offset: stride * i,
      index: i,
    }),
    [stride],
  );

  const renderItem = useCallback(
    ({ item, index: col }: ListRenderItemInfo<TvTile>) => (
      <RowTile
        tile={item}
        rowId={model.id}
        kind={model.kind}
        column={col}
        last={col === model.tiles.length - 1}
        preferred={preferFirst && col === 0}
        onFocusColumn={focusColumn}
        onPress={events.onTilePress}
      />
    ),
    [model, preferFirst, focusColumn, events.onTilePress],
  );

  return (
    <FocusRow style={{ height: rowHeight(model.kind) }}>
      <TvText variant="rowLabel" numberOfLines={1} style={styles.label}>
        {model.label}
      </TvText>
      <FlatList
        ref={list}
        horizontal
        data={model.tiles}
        keyExtractor={tileKey}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        scrollEnabled={false}
        scrollsChildToFocus={false}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initial || undefined}
        initialNumToRender={Math.ceil((SCREEN.width - CONTENT_X) / stride) + 1}
        maxToRenderPerBatch={6}
        windowSize={3}
        contentContainerStyle={styles.strip}
        style={styles.list}
      />
    </FocusRow>
  );
});

const RowTile = memo(function RowTile({
  tile,
  rowId,
  kind,
  column,
  last,
  preferred,
  onFocusColumn,
  onPress,
}: {
  tile: TvTile;
  rowId: string;
  kind: RowKind;
  column: number;
  last: boolean;
  preferred: boolean;
  onFocusColumn: (column: number) => void;
  onPress: (tile: TvTile) => void;
}) {
  const art =
    kind === "box" || kind === "continue" ? (
      <BoxArt
        title={tile.title}
        width={BOX.width}
        height={BOX.height}
        progress={
          tile.progress
            ? progressFraction(tile.progress.positionS, tile.progress.durationS)
            : undefined
        }
      />
    ) : (
      <PosterArt
        title={tile.title}
        width={POSTER.width}
        height={POSTER.height}
      />
    );
  const focusable = (
    <Focusable
      focusKey={`${rowId}:${column}`}
      preferred={preferred}
      next={last ? LAST_TILE : undefined}
      accessibilityRole="button"
      accessibilityLabel={
        tile.rank
          ? `Number ${tile.rank}, ${tile.title.title}`
          : tile.title.title
      }
      onFocus={() => onFocusColumn(column)}
      onPress={() => onPress(tile)}
      radius={4}
      grow={kind === "poster" || kind === "rank" ? 1.07 : 1.05}
    >
      {art}
    </Focusable>
  );
  if (kind !== "rank") return <View style={styles.cell}>{focusable}</View>;
  return (
    <View style={[styles.cell, styles.rankCell]}>
      <Numeral rank={tile.rank ?? column + 1} />
      <View style={styles.rankPoster}>{focusable}</View>
    </View>
  );
});

const tileKey = (tile: TvTile) => tile.key;

const LAST_TILE = { right: "self" } as const;

const NUMERAL_SIZE = 136;
const NUMERAL_WIDTH = RANK_WIDTH + 44;

/** The rank in outline, half tucked behind its poster. */
function Numeral({ rank }: { rank: number }) {
  return (
    <Svg
      width={NUMERAL_WIDTH}
      height={POSTER.height}
      style={styles.numeral}
      pointerEvents="none"
    >
      <SvgText
        x={NUMERAL_WIDTH}
        y={POSTER.height - 6}
        textAnchor="end"
        fontFamily={fonts.display}
        fontSize={NUMERAL_SIZE}
        fill={colors.ink}
        stroke="rgba(239,233,223,0.62)"
        strokeWidth={2.5}
      >
        {String(rank)}
      </SvgText>
    </Svg>
  );
}

const styles = StyleSheet.create({
  label: {
    height: ROW_LABEL,
    paddingLeft: CONTENT_X,
    paddingRight: TV_SAFE.x,
  },
  list: { flexGrow: 0, overflow: "visible" },
  strip: {
    paddingLeft: CONTENT_X,
    paddingRight: TV_SAFE.x,
    paddingVertical: FOCUS_ROOM,
  },
  cell: { marginRight: TILE_GAP },
  rankCell: { width: RANK_WIDTH + POSTER.width },
  rankPoster: { marginLeft: RANK_WIDTH },
  numeral: { position: "absolute", left: 0, top: 0 },
});
