import type { SearchResult, TitleSummary } from "@repo/schemas/stream";
import { router } from "expo-router";
import {
  Delete,
  type LucideIcon,
  Search,
  Space,
  Sparkles,
  Tag,
  UserRound,
  X,
} from "lucide-react-native";
import { memo, type ReactNode, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSearch } from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { colors, spacing } from "@/ui";
import { BoxArt } from "./artwork";
import { FOCUS_ROOM, Focusable } from "./focusable";
import { CONTENT_X, SCREEN, TV_SAFE } from "./layout";
import { openTvTitle } from "./open";
import { TvShell } from "./shell";
import { TvText } from "./tv-text";

const KEYS = "abcdefghijklmnopqrstuvwxyz1234567890".split("");
const COLUMNS = 6;
const KEY = { width: 40, height: 36, gap: 4 } as const;
const PAD_WIDTH = COLUMNS * KEY.width + (COLUMNS - 1) * KEY.gap;
const RESULTS_X = CONTENT_X + PAD_WIDTH + 44;
const RESULT_GAP = 14;
const RESULT_COLUMNS = 3;
const RESULT = {
  width: Math.floor(
    (SCREEN.width - TV_SAFE.x - RESULTS_X - RESULT_GAP * (RESULT_COLUMNS - 1)) /
      RESULT_COLUMNS,
  ),
} as const;
const RESULT_HEIGHT = Math.round((RESULT.width * 9) / 16);

function useDebounced(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Search the way a TV does it: an on-screen keyboard on the left driven by
 * the D-pad, results on the right updating with every letter. With nothing
 * typed, the right side shows what everyone is searching for.
 */
export function TvSearchScreen() {
  const { key } = useAudience();
  const [q, setQ] = useState("");
  const settled = useDebounced(q.trim(), 220);
  const search = useSearch(key, settled);
  const result = search.data ?? null;

  const type = useCallback((letter: string) => {
    setQ((current) => (current.length >= 60 ? current : current + letter));
  }, []);
  const erase = useCallback(() => setQ((current) => current.slice(0, -1)), []);
  const clear = useCallback(() => setQ(""), []);

  return (
    <TvShell section="search">
      <View style={styles.screen}>
        <View style={styles.pad}>
          <View style={styles.query}>
            <Search size={22} color={q ? colors.amber : colors.muted} />
            <TvText
              variant={q ? "heading" : "lede"}
              color={q ? "paper" : "muted"}
              numberOfLines={1}
              ellipsizeMode="head"
              style={styles.queryText}
            >
              {q || "Type to search"}
            </TvText>
          </View>
          <Keyboard onType={type} onErase={erase} onClear={clear} />
          <Suggestions result={settled ? result : null} />
        </View>
        <Results
          query={settled}
          result={result}
          loading={search.isPending || (search.isFetching && !result)}
          failed={search.isError && !result}
        />
      </View>
    </TvShell>
  );
}

/** Memoised with stable callbacks: typing re-renders none of the keys. */
const Keyboard = memo(function Keyboard({
  onType,
  onErase,
  onClear,
}: {
  onType: (letter: string) => void;
  onErase: () => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.keyboard}>
      <View style={styles.keyRow}>
        <Key label="Space" icon={Space} span={2} onPress={() => onType(" ")} />
        <Key label="Delete" icon={Delete} span={2} onPress={onErase} />
        <Key label="Clear" icon={X} span={2} onPress={onClear} />
      </View>
      <View style={styles.keyGrid}>
        {KEYS.map((letter, index) => (
          <Key
            key={letter}
            label={letter}
            preferred={index === 0}
            onPress={() => onType(letter)}
          />
        ))}
      </View>
    </View>
  );
});

function Key({
  label,
  icon: Icon,
  span = 1,
  preferred,
  onPress,
}: {
  label: string;
  icon?: LucideIcon;
  span?: number;
  preferred?: boolean;
  onPress: () => void;
}) {
  return (
    <Focusable
      accessibilityRole="keyboardkey"
      accessibilityLabel={label}
      preferred={preferred}
      focusKey={`key:${label}`}
      onPress={onPress}
      ringless
      grow={1.08}
    >
      {(focused) => (
        <View
          style={[
            styles.key,
            { width: span * KEY.width + (span - 1) * KEY.gap },
            focused ? styles.keyFocused : null,
          ]}
        >
          {Icon ? (
            <Icon size={20} color={focused ? colors.ink : colors.paper} />
          ) : (
            <TvText variant="key" color={focused ? "ink" : "paper"}>
              {label}
            </TvText>
          )}
        </View>
      )}
    </Focusable>
  );
}

interface Suggestion {
  key: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
}

function suggestionsFor(result: SearchResult | null): Suggestion[] {
  const list: Suggestion[] = [];
  for (const person of result?.people.slice(0, 2) ?? []) {
    list.push({
      key: `person:${person.name}`,
      label: person.name,
      icon: UserRound,
      onPress: () =>
        router.push({
          pathname: "/tv/actor/[name]",
          params: { name: person.name },
        }),
    });
  }
  for (const genre of result?.genres.slice(0, 1) ?? []) {
    list.push({
      key: `genre:${genre}`,
      label: genre,
      icon: Tag,
      onPress: () =>
        router.push({
          pathname: "/tv/collection",
          params: { genres: genre, label: genre },
        }),
    });
  }
  for (const keyword of result?.keywords ?? []) {
    if (list.length >= 3) break;
    list.push({
      key: `keyword:${keyword}`,
      label: keyword,
      icon: Tag,
      onPress: () =>
        router.push({
          pathname: "/tv/collection",
          params: { keyword, label: keyword },
        }),
    });
  }
  list.push({
    key: "ask",
    label: "Describe what you'd like",
    icon: Sparkles,
    onPress: () => router.push("/tv/ask"),
  });
  return list;
}

/** People, a genre and themes that match, then a way to just describe it. */
function Suggestions({ result }: { result: SearchResult | null }) {
  return (
    <View style={styles.suggestions}>
      {suggestionsFor(result).map((item) => (
        <Focusable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          focusKey={`suggestion:${item.key}`}
          onPress={item.onPress}
          ringless
          grow={1}
        >
          {(focused) => (
            <View
              style={[styles.suggestion, focused ? styles.keyFocused : null]}
            >
              <item.icon
                size={16}
                color={focused ? colors.ink : colors.muted}
              />
              <TvText
                variant={focused ? "bodyStrong" : "body"}
                color={focused ? "ink" : "paper"}
                numberOfLines={1}
                style={styles.shrink}
              >
                {item.label}
              </TvText>
            </View>
          )}
        </Focusable>
      ))}
    </View>
  );
}

function Results({
  query,
  result,
  loading,
  failed,
}: {
  query: string;
  result: SearchResult | null;
  loading: boolean;
  failed: boolean;
}) {
  const titles = result?.titles ?? [];
  if (failed) {
    return (
      <Side>
        <TvText variant="heading">Search isn't answering</TvText>
        <TvText variant="lede" color="muted">
          Check that the TV is connected to the internet, then type again.
        </TvText>
      </Side>
    );
  }
  if (loading && titles.length === 0) {
    return (
      <Side>
        <ActivityIndicator color={colors.muted} size="large" />
      </Side>
    );
  }
  if (query && titles.length === 0) {
    return (
      <Side>
        <TvText variant="heading" numberOfLines={2}>
          Nothing matches "{query}"
        </TvText>
        <TvText variant="lede" color="muted">
          Try another spelling, fewer letters, or the name of someone in it.
        </TvText>
      </Side>
    );
  }
  return (
    <View style={styles.results}>
      <TvText variant="rowLabel" numberOfLines={1} style={styles.resultsLabel}>
        {query ? "Films and series" : "Popular searches"}
      </TvText>
      <ResultGrid titles={titles} />
    </View>
  );
}

function Side({ children }: { children: ReactNode }) {
  return <View style={styles.side}>{children}</View>;
}

const ResultGrid = memo(function ResultGrid({
  titles,
}: {
  titles: TitleSummary[];
}) {
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.grid}
      showsVerticalScrollIndicator={false}
    >
      {titles.map((title, index) => (
        <Focusable
          key={title.id}
          focusKey={`result:${title.id}`}
          accessibilityRole="button"
          accessibilityLabel={title.title}
          next={
            index % RESULT_COLUMNS === RESULT_COLUMNS - 1 ||
            index === titles.length - 1
              ? { right: "self" }
              : undefined
          }
          onPress={() => openTvTitle(title.id)}
          radius={4}
          grow={1.05}
        >
          <BoxArt title={title} width={RESULT.width} height={RESULT_HEIGHT} />
        </Focusable>
      ))}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, flexDirection: "row", backgroundColor: colors.ink },
  fill: { flex: 1 },
  pad: {
    marginLeft: CONTENT_X,
    width: PAD_WIDTH,
    paddingTop: TV_SAFE.y + spacing.sm,
    gap: spacing.md,
  },
  query: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: colors.hairline,
  },
  queryText: { flex: 1 },
  keyboard: { gap: KEY.gap },
  keyRow: { flexDirection: "row", gap: KEY.gap },
  keyGrid: { flexDirection: "row", flexWrap: "wrap", gap: KEY.gap },
  key: {
    height: KEY.height,
    width: KEY.width,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239,233,223,0.07)",
  },
  keyFocused: { backgroundColor: colors.paper },
  suggestions: { gap: 2 },
  suggestion: {
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 4,
  },
  shrink: { flexShrink: 1 },
  results: {
    position: "absolute",
    left: RESULTS_X - FOCUS_ROOM,
    right: TV_SAFE.x - FOCUS_ROOM,
    top: TV_SAFE.y + spacing.sm,
    bottom: 0,
    gap: spacing.xs,
  },
  resultsLabel: { height: 24, paddingLeft: FOCUS_ROOM },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: RESULT_GAP,
    padding: FOCUS_ROOM,
    paddingBottom: TV_SAFE.y + FOCUS_ROOM,
  },
  side: {
    position: "absolute",
    left: RESULTS_X,
    right: TV_SAFE.x,
    top: TV_SAFE.y + 60,
    gap: spacing.md,
  },
});
