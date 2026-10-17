import {
  ExploredMapView,
  LocationNative,
  type MapFrameMode,
} from "@modules/location-native";
import { colors, haptics, Notice, spacing, Text } from "@repo/native-ui";
import { useFocusEffect } from "expo-router";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useExplored } from "@/api/location";
import { area, distance } from "@/lib/format";
import { useTracker } from "../explore/use-tracker";

const SESSION_POLL_MS = 4_000;
const NO_TRACKS: number[][] = [];
const NO_SPOTS: [number, number][] = [];

/**
 * Everything explored, as on the desktop, with the walk in progress on top.
 * Controls sit under the status bar, clear of the tab bar and the corners.
 */
export function MapScreen() {
  const insets = useSafeAreaInsets();
  const explored = useExplored();
  const { status } = useTracker();
  const exploring = status?.exploring ?? false;
  const [session, setSession] = useState<number[]>([]);
  const [frame, setFrame] = useState<{ mode: MapFrameMode; key: number }>({
    mode: "all",
    key: 1,
  });

  useFocusEffect(
    useCallback(() => {
      const read = () => setSession(LocationNative?.sessionTrail() ?? []);
      read();
      const timer = setInterval(read, SESSION_POLL_MS);
      void explored.refetch();
      return () => clearInterval(timer);
    }, [explored.refetch]),
  );

  const reframe = (mode: MapFrameMode) => {
    haptics.selection();
    setFrame((current) => ({ mode, key: current.key + 1 }));
  };

  const data = explored.data;

  return (
    <View style={styles.screen}>
      {ExploredMapView ? (
        <ExploredMapView
          style={StyleSheet.absoluteFill}
          tracks={data?.tracks ?? NO_TRACKS}
          spots={data?.spots ?? NO_SPOTS}
          session={session}
          radiusMetres={10}
          frameMode={frame.mode}
          frameKey={frame.key}
        />
      ) : null}
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.stats}>
          <Text variant="caption2" tone="secondary" eyebrow>
            {exploring ? "Exploring" : "Explored"}
          </Text>
          <Text variant="headline" figure>
            {data ? area(data.areaSquareMetres.r10) : "—"}
          </Text>
          <Text variant="caption1" tone="secondary" figure>
            {data
              ? `${distance(data.distanceMetres)} · ${data.points.toLocaleString("en-GB")} fixes`
              : explored.isFetching
                ? "…"
                : "—"}
          </Text>
        </View>
        <View style={styles.buttons}>
          <MapButton
            symbol="figure.walk"
            label="This walk"
            active={frame.mode === "session"}
            onPress={() => reframe("session")}
          />
          <MapButton
            symbol="square.dashed"
            label="Everything"
            active={frame.mode === "all"}
            onPress={() => reframe("all")}
          />
          <MapButton
            symbol="location"
            label="Me"
            active={frame.mode === "user"}
            onPress={() => reframe("user")}
          />
        </View>
      </View>
      {explored.error ? (
        <View style={styles.notice}>
          <Notice message={explored.error.message} />
        </View>
      ) : null}
    </View>
  );
}

function MapButton({
  symbol,
  label,
  active,
  onPress,
}: {
  symbol: SymbolViewProps["name"];
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        active && styles.buttonActive,
        pressed && { opacity: 0.6 },
      ]}
    >
      <SymbolView
        name={symbol}
        size={17}
        weight="semibold"
        tintColor={active ? colors.onTint : colors.label}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  stats: {
    gap: spacing.xxs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 14,
    backgroundColor: colors.background,
  },
  buttons: { gap: spacing.sm },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  buttonActive: { backgroundColor: colors.tint },
  notice: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    top: "40%",
  },
});
