import { useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
} from "react-native";
import { formatClock, progressFraction } from "@/lib/time";
import { colors, spacing, Text } from "@/ui";

/**
 * The seek bar. Dragging previews the time and seeks once on release, so a
 * scrub is one seek, not hundreds. Adjustable for VoiceOver / TalkBack in
 * 10-second steps.
 */
export function Scrubber({
  position,
  duration,
  disabled,
  onSeek,
  onScrubbing,
}: {
  position: number;
  duration: number;
  disabled: boolean;
  onSeek: (seconds: number) => void;
  onScrubbing: (active: boolean) => void;
}) {
  const width = useRef(0);
  const start = useRef(0);
  const [preview, setPreview] = useState<number | null>(null);
  const live = useRef({ duration, disabled, onSeek, onScrubbing });
  live.current = { duration, disabled, onSeek, onScrubbing };

  const fractionAt = (x: number) =>
    width.current > 0 ? Math.min(1, Math.max(0, x / width.current)) : 0;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        !live.current.disabled && live.current.duration > 0,
      onMoveShouldSetPanResponder: () =>
        !live.current.disabled && live.current.duration > 0,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        start.current = event.nativeEvent.locationX;
        live.current.onScrubbing(true);
        setPreview(fractionAt(start.current) * live.current.duration);
      },
      onPanResponderMove: (_event, gesture) => {
        setPreview(
          fractionAt(start.current + gesture.dx) * live.current.duration,
        );
      },
      onPanResponderRelease: (_event, gesture) => {
        live.current.onSeek(
          fractionAt(start.current + gesture.dx) * live.current.duration,
        );
        setPreview(null);
        live.current.onScrubbing(false);
      },
      onPanResponderTerminate: () => {
        setPreview(null);
        live.current.onScrubbing(false);
      },
    }),
  ).current;

  const shown = preview ?? position;
  const fraction = progressFraction(shown, duration);
  const remaining = duration > 0 ? duration - shown : 0;

  return (
    <View style={styles.wrap}>
      <View
        {...responder.panHandlers}
        onLayout={(event: LayoutChangeEvent) => {
          width.current = event.nativeEvent.layout.width;
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityValue={{
          text: `${formatClock(shown)} of ${formatClock(duration)}`,
        }}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          if (disabled) return;
          onSeek(
            position +
              (event.nativeEvent.actionName === "increment" ? 10 : -10),
          );
        }}
        style={styles.hit}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
        </View>
        {!disabled ? (
          <View
            style={[
              styles.thumb,
              {
                left: `${fraction * 100}%`,
                transform: [{ scale: preview !== null ? 1.4 : 1 }],
              },
            ]}
          />
        ) : null}
      </View>
      <View style={styles.times}>
        <Text variant="caption">{formatClock(shown)}</Text>
        <Text variant="caption" color="muted">
          {duration > 0 ? `-${formatClock(remaining)}` : "--:--"}
        </Text>
      </View>
    </View>
  );
}

const THUMB = 14;

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  hit: { height: 28, justifyContent: "center" },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    overflow: "hidden",
  },
  fill: { height: 4, backgroundColor: colors.amber },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: colors.amber,
  },
  times: { flexDirection: "row", justifyContent: "space-between" },
});
