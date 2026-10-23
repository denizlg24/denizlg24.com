import type { Episode } from "@repo/schemas/stream";
import { LinearGradient } from "expo-linear-gradient";
import {
  Captions,
  Gauge,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  X,
} from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatClock } from "@/lib/time";
import { Button, colors, IconButton, radius, spacing, Text } from "@/ui";
import { AirPlayButton } from "./airplay-button";
import {
  PLAYBACK_RATES,
  type PlayerController,
  rateLabel,
  SKIP_SECONDS,
} from "./controller";
import { Scrubber } from "./scrubber";
import { useAutoHide } from "./use-auto-hide";

type Menu = "captions" | "speed" | null;

export interface PlayerChromeProps {
  controller: PlayerController;
  title: string;
  subtitle?: string;
  next: Episode | null;
  onNext: () => void;
  onClose: () => void;
  /** Shown for a few seconds after picking up where someone left off. */
  resumedAt: number | null;
  onStartOver: () => void;
  /** The calm notice in place of a picture, when there is nothing to play. */
  notice?: { title: string; message: string };
}

/**
 * The player's own controls over the picture (or over the backdrop when
 * nothing can play): close, title, captions, speed, AirPlay, picture in
 * picture; ±10 s and play/pause; the seek bar and next episode.
 */
export function PlayerChrome({
  controller: c,
  title,
  subtitle,
  next,
  onNext,
  onClose,
  resumedAt,
  onStartOver,
  notice,
}: PlayerChromeProps) {
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState<Menu>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const hide = useAutoHide(c.playing, menu !== null || scrubbing);
  const disabled = !c.available;
  const visible = hide.visible || disabled;
  const act = (fn: () => void) => () => {
    fn();
    hide.poke();
  };
  const edges = {
    paddingTop: insets.top + spacing.sm,
    paddingBottom: insets.bottom + spacing.md,
    paddingLeft: insets.left + spacing.lg,
    paddingRight: insets.right + spacing.lg,
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityLabel={visible ? "Hide controls" : "Show controls"}
        onPress={() => (menu ? setMenu(null) : hide.toggle())}
      />

      {notice ? (
        <View pointerEvents="none" style={styles.notice}>
          <Text variant="title" style={styles.center}>
            {notice.title}
          </Text>
          <Text variant="body" color="muted" style={styles.center}>
            {notice.message}
          </Text>
        </View>
      ) : null}

      {c.buffering && !disabled ? (
        <View pointerEvents="none" style={styles.centerFill}>
          <ActivityIndicator color={colors.paper} size="large" />
        </View>
      ) : null}

      {visible ? (
        <View style={[StyleSheet.absoluteFill, edges]} pointerEvents="box-none">
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(0,0,0,0.7)", "rgba(0,0,0,0)"]}
            style={styles.topShade}
          />
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.78)"]}
            style={styles.bottomShade}
          />

          <View style={styles.top} pointerEvents="box-none">
            <IconButton icon={X} label="Close player" onPress={onClose} />
            <View style={styles.heading}>
              <Text variant="headline" numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text variant="footnote" color="muted" numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <IconButton
              icon={Captions}
              label="Subtitles"
              color={c.subtitle ? colors.amber : undefined}
              disabled={disabled}
              onPress={act(() =>
                setMenu(menu === "captions" ? null : "captions"),
              )}
            />
            <IconButton
              icon={Gauge}
              label={`Playback speed, ${rateLabel(c.rate)}`}
              color={c.rate !== 1 ? colors.amber : undefined}
              disabled={disabled}
              onPress={act(() => setMenu(menu === "speed" ? null : "speed"))}
            />
            <AirPlayButton disabled={disabled} />
            {c.pictureInPicture ? (
              <IconButton
                icon={PictureInPicture2}
                label="Picture in picture"
                disabled={disabled}
                onPress={act(c.startPictureInPicture)}
              />
            ) : null}
          </View>

          <View style={styles.middle} pointerEvents="box-none">
            <IconButton
              icon={RotateCcw}
              label={`Back ${SKIP_SECONDS} seconds`}
              size={30}
              disabled={disabled}
              onPress={act(() => c.seekBy(-SKIP_SECONDS))}
            />
            <IconButton
              icon={c.playing ? Pause : Play}
              label={c.playing ? "Pause" : "Play"}
              size={44}
              filled
              disabled={disabled}
              onPress={act(c.toggle)}
            />
            <IconButton
              icon={RotateCw}
              label={`Forward ${SKIP_SECONDS} seconds`}
              size={30}
              disabled={disabled}
              onPress={act(() => c.seekBy(SKIP_SECONDS))}
            />
          </View>

          <View style={styles.bottom} pointerEvents="box-none">
            {resumedAt !== null && !disabled ? (
              <View style={styles.resume}>
                <Text variant="footnote">
                  Picked up at {formatClock(resumedAt)}
                </Text>
                <Button
                  label="Start over"
                  variant="secondary"
                  onPress={act(onStartOver)}
                />
              </View>
            ) : null}
            <View style={styles.scrubRow}>
              <View style={styles.grow}>
                <Scrubber
                  position={c.position}
                  duration={c.duration}
                  disabled={disabled}
                  onSeek={c.seekTo}
                  onScrubbing={setScrubbing}
                />
              </View>
              {next ? (
                <Button
                  label="Next episode"
                  icon={SkipForward}
                  variant="secondary"
                  disabled={disabled}
                  onPress={onNext}
                />
              ) : null}
            </View>
          </View>

          {menu ? (
            <View
              style={[
                styles.menu,
                { top: insets.top + 56, right: insets.right + spacing.lg },
              ]}
            >
              <ScrollView contentContainerStyle={styles.menuContent}>
                {menu === "captions" ? (
                  <>
                    <MenuItem
                      label="Off"
                      selected={c.subtitle === null}
                      onPress={() => {
                        c.setSubtitle(null);
                        setMenu(null);
                      }}
                    />
                    {c.subtitles.map((option) => (
                      <MenuItem
                        key={option.id}
                        label={option.label}
                        selected={c.subtitle === option.id}
                        onPress={() => {
                          c.setSubtitle(option.id);
                          setMenu(null);
                        }}
                      />
                    ))}
                    {c.subtitles.length === 0 ? (
                      <Text
                        variant="footnote"
                        color="muted"
                        style={styles.menuNote}
                      >
                        No subtitles for this one.
                      </Text>
                    ) : null}
                  </>
                ) : (
                  PLAYBACK_RATES.map((rate) => (
                    <MenuItem
                      key={rate}
                      label={rateLabel(rate)}
                      selected={c.rate === rate}
                      onPress={() => {
                        c.setRate(rate);
                        setMenu(null);
                      }}
                    />
                  ))
                )}
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function MenuItem({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text variant="callout" color={selected ? "amber" : "paper"}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
  centerFill: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxxl * 2,
    gap: spacing.sm,
    paddingTop: 120,
  },
  topShade: { position: "absolute", top: 0, left: 0, right: 0, height: 140 },
  bottomShade: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 180,
  },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  heading: { flex: 1, paddingHorizontal: spacing.sm },
  middle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxxl,
  },
  bottom: { gap: spacing.md },
  resume: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  scrubRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  grow: { flex: 1 },
  menu: {
    position: "absolute",
    width: 220,
    maxHeight: 260,
    borderRadius: radius.lg,
    backgroundColor: "rgba(20,20,24,0.94)",
  },
  menuContent: { paddingVertical: spacing.sm },
  menuItem: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  menuNote: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
