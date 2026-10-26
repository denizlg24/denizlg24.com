import type { Episode } from "@repo/schemas/stream";
import { LinearGradient } from "expo-linear-gradient";
import {
  FastForward,
  Pause,
  Play,
  Rewind,
  SkipForward,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  type DimensionValue,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { episodeLabel } from "@/lib/format";
import { formatClock, progressFraction } from "@/lib/time";
import { Button, colors, IconButton, spacing, Text } from "@/ui";
import { TV_SAFE } from "../layout";
import { type RemoteKey, useRemote } from "../remote";
import { SKIP_STEP_S } from "./seek";
import { useSeekBuffer } from "./use-seek-buffer";

/** What the remote drives, whether the picture is a file or an embed. */
export interface TvTransport {
  /** False until the player can take commands. */
  ready: boolean;
  playing: boolean;
  buffering: boolean;
  /** Seconds. */
  position: number;
  /** Seconds; 0 until known. */
  duration: number;
  toggle(): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
}

export interface TvAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

const HIDE_AFTER_MS = 5000;
const NEXT_COUNTDOWN_S = 10;

type FocusTarget = "play" | "scrub";

/**
 * Remote-first player controls. Hidden, a transparent layer holds focus so
 * no key ever reaches the picture underneath (an embed's page included) and
 * every key acts at once: OK plays or pauses, left and right seek, up and
 * down bring the controls back. Shown, the D-pad moves between them; on the
 * seek bar, left and right seek. Back hides them, then closes the player.
 */
export function TvPlayerChrome({
  transport,
  title,
  subtitle,
  notice,
  hint,
  onSelectWhileNotReady,
  ended,
  next,
  onNext,
  onClose,
  resumedAt,
  onStartOver,
  actions = [],
  inactive = false,
}: {
  transport: TvTransport;
  title: string;
  subtitle?: string;
  /** Replaces the controls: nothing can play. */
  notice?: { title: string; message: string } | null;
  /** One line over the picture while it waits, e.g. to press OK to start. */
  hint?: string | null;
  /** OK before the player is ready, for a picture that needs a nudge to start. */
  onSelectWhileNotReady?: () => void;
  ended: boolean;
  next: Episode | null;
  onNext: () => void;
  onClose: () => void;
  resumedAt: number | null;
  onStartOver: () => void;
  actions?: TvAction[];
  /** Something is open over the controls and takes the remote and Back. */
  inactive?: boolean;
}) {
  const [visible, setVisible] = useState(true);
  const [focusOn, setFocusOn] = useState<FocusTarget>("play");
  const [focusKey, setFocusKey] = useState(0);
  const [scrubFocused, setScrubFocused] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [remaining, setRemaining] = useState(NEXT_COUNTDOWN_S);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestNext = useRef(onNext);
  latestNext.current = onNext;
  const counting = ended && next !== null && !cancelled && !notice;

  const seek = useSeekBuffer({
    position: transport.position,
    duration: transport.duration,
    commit: transport.seekTo,
  });

  const keepOpen = !transport.playing || !!notice || counting || inactive;
  const poke = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!keepOpen) {
      timer.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    }
  }, [keepOpen]);

  useEffect(() => {
    if (visible) poke();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [visible, poke]);

  const show = (target: FocusTarget) => {
    if (!visible) {
      setFocusOn(target);
      setFocusKey((value) => value + 1);
      setVisible(true);
    }
    poke();
  };

  useEffect(() => {
    if (!ended) setCancelled(false);
  }, [ended]);

  useEffect(() => {
    if (!counting) return;
    setVisible(true);
    const deadline = Date.now() + NEXT_COUNTDOWN_S * 1000;
    setRemaining(NEXT_COUNTDOWN_S);
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        clearInterval(interval);
        setCancelled(true);
        latestNext.current();
      }
    }, 250);
    return () => clearInterval(interval);
  }, [counting]);

  useRemote((key: RemoteKey) => {
    if (notice || inactive) return;
    switch (key) {
      case "playPause":
        transport.toggle();
        show("play");
        return;
      case "play":
        transport.play();
        show("play");
        return;
      case "pause":
        transport.pause();
        show("play");
        return;
      case "fastForward":
      case "rewind":
        if (transport.ready) seek.nudge(key === "rewind" ? -1 : 1, SKIP_STEP_S);
        show("scrub");
        return;
      case "next":
        if (next) onNext();
        return;
      case "stop":
        onClose();
        return;
      case "select":
        // Shown, OK is the focused control's own press.
        if (visible) return poke();
        if (transport.ready) transport.toggle();
        else onSelectWhileNotReady?.();
        show("play");
        return;
      case "left":
      case "right":
        if (!visible || scrubFocused) {
          if (transport.ready) seek.nudge(key === "left" ? -1 : 1);
          show("scrub");
        } else poke();
        return;
      default:
        show("play");
    }
  });

  useEffect(() => {
    if (inactive) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (counting) setCancelled(true);
        else if (visible && !notice && transport.playing) setVisible(false);
        else onClose();
        return true;
      },
    );
    return () => subscription.remove();
  }, [counting, visible, notice, transport.playing, onClose, inactive]);

  const shown = seek.target ?? transport.position;
  const fraction = progressFraction(shown, transport.duration);

  if (notice) {
    return (
      <View style={styles.notice}>
        <Text variant="hero">{notice.title}</Text>
        <Text variant="lede" color="muted" style={styles.noticeText}>
          {notice.message}
        </Text>
        <Button label="Go back" size="large" preferred onPress={onClose} />
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      {!visible && !inactive ? (
        <Pressable
          key={`catch:${focusKey}`}
          style={StyleSheet.absoluteFill}
          focusable
          // Typed as Apple TV only and deprecated, but Android's view manager
          // still implements it: it requests focus when the prop turns true.
          hasTVPreferredFocus
          accessibilityLabel="Player. Press OK to play or pause, left or right to seek, down for the controls."
        />
      ) : null}

      {hint && !transport.ready ? (
        <View style={styles.hint} pointerEvents="none">
          <Text variant="headline">{hint}</Text>
        </View>
      ) : null}

      {transport.buffering ? (
        <ActivityIndicator
          color={colors.paper}
          size="large"
          style={styles.spinner}
        />
      ) : null}

      {visible && !inactive ? (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(0,0,0,0.75)", "rgba(0,0,0,0)"]}
            style={styles.top}
          >
            <Text variant="title" numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text variant="body" color="muted" numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </LinearGradient>

          <LinearGradient
            colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.85)"]}
            style={styles.bottom}
          >
            {counting && next ? (
              <View style={styles.upNext}>
                <Text variant="headline">
                  Next:{" "}
                  {[episodeLabel(next.season, next.episode), next.title]
                    .filter(Boolean)
                    .join(" ")}
                </Text>
                <Text variant="body" color="muted">
                  Starts in {remaining} s
                </Text>
                <View style={styles.row}>
                  <Button
                    label="Play now"
                    size="large"
                    preferred
                    onPress={() => {
                      setCancelled(true);
                      onNext();
                    }}
                  />
                  <Button
                    label="Cancel"
                    variant="secondary"
                    size="large"
                    onPress={() => setCancelled(true)}
                  />
                </View>
              </View>
            ) : null}

            <Pressable
              key={`scrub:${focusKey}`}
              focusable={transport.ready}
              // See the catcher above: Android honours this.
              hasTVPreferredFocus={focusOn === "scrub" && !counting}
              accessibilityRole="adjustable"
              accessibilityLabel="Seek"
              onPress={() => transport.toggle()}
              onFocus={() => setScrubFocused(true)}
              onBlur={() => setScrubFocused(false)}
              style={styles.scrub}
            >
              <View
                style={[styles.track, scrubFocused ? styles.trackOn : null]}
              >
                <View
                  style={[
                    styles.fill,
                    {
                      width:
                        `${Math.round(fraction * 1000) / 10}%` as DimensionValue,
                    },
                  ]}
                />
                {scrubFocused ? (
                  <View
                    style={[
                      styles.thumb,
                      {
                        left: `${Math.round(fraction * 1000) / 10}%` as DimensionValue,
                      },
                    ]}
                  />
                ) : null}
              </View>
              <View style={styles.times}>
                <Text
                  variant="callout"
                  color={seek.target !== null ? "amber" : "paper"}
                >
                  {formatClock(shown)}
                </Text>
                <Text variant="callout" color="muted">
                  {transport.duration > 0
                    ? `-${formatClock(Math.max(0, transport.duration - shown))}`
                    : ""}
                </Text>
              </View>
            </Pressable>

            <View style={styles.row} key={`controls:${focusKey}`}>
              <IconButton
                icon={Rewind}
                label={`Back ${SKIP_STEP_S} seconds`}
                size={26}
                disabled={!transport.ready}
                onPress={() => seek.nudge(-1, SKIP_STEP_S)}
              />
              <IconButton
                icon={transport.playing ? Pause : Play}
                label={transport.playing ? "Pause" : "Play"}
                size={32}
                filled
                hasTVPreferredFocus={focusOn === "play" && !counting}
                onPress={() =>
                  transport.ready
                    ? transport.toggle()
                    : onSelectWhileNotReady?.()
                }
              />
              <IconButton
                icon={FastForward}
                label={`Forward ${SKIP_STEP_S} seconds`}
                size={26}
                disabled={!transport.ready}
                onPress={() => seek.nudge(1, SKIP_STEP_S)}
              />
              <View style={styles.spacer} />
              {resumedAt !== null ? (
                <Button
                  label="Start over"
                  variant="secondary"
                  size="large"
                  onPress={onStartOver}
                />
              ) : null}
              {next && !counting ? (
                <Button
                  label="Next episode"
                  icon={SkipForward}
                  variant="secondary"
                  size="large"
                  onPress={onNext}
                />
              ) : null}
              {actions.map((action) => (
                <Button
                  key={action.label}
                  label={action.label}
                  variant="secondary"
                  size="large"
                  disabled={action.disabled}
                  onPress={action.onPress}
                />
              ))}
            </View>
          </LinearGradient>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: TV_SAFE.x,
    paddingTop: TV_SAFE.y,
    paddingBottom: spacing.xxxl,
    gap: spacing.xs,
  },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: TV_SAFE.x,
    paddingBottom: TV_SAFE.y,
    paddingTop: spacing.xxxl * 2,
    gap: spacing.lg,
  },
  upNext: { gap: spacing.sm, alignSelf: "flex-end", maxWidth: 420 },
  scrub: { gap: spacing.sm, paddingVertical: spacing.sm },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(239,233,223,0.25)",
  },
  trackOn: { height: 8, borderRadius: 4 },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 4,
    backgroundColor: colors.amber,
  },
  thumb: {
    position: "absolute",
    top: -6,
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    backgroundColor: colors.paper,
  },
  times: { flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  spacer: { flex: 1 },
  hint: {
    position: "absolute",
    bottom: TV_SAFE.y + spacing.xxxl * 3,
    alignSelf: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 10,
    backgroundColor: "rgba(12,11,10,0.8)",
  },
  spinner: { position: "absolute", alignSelf: "center", top: "45%" },
  notice: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: TV_SAFE.x * 2,
    gap: spacing.lg,
    alignItems: "flex-start",
  },
  noticeText: { maxWidth: 640 },
});
