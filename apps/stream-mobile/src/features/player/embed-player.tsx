import type { Playback } from "@repo/schemas/stream";
import {
  allowEmbedNavigation,
  EMBED_BROWSER_SCRIPT,
  type EmbedProgress,
  embedPlayerUrl,
  parseEmbedProgress,
} from "@repo/schemas/stream";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import {
  invalidateAfterWatching,
  useRecordProgress,
  useRecordViewing,
} from "@/api/stream";
import { formatClock } from "@/lib/time";
import { Button, colors, spacing, Text } from "@/ui";

export function EmbedPlayer({
  playback,
  titleId,
  profileIds,
  title,
  subtitle,
  onClose,
  onNext,
}: {
  playback: Playback;
  titleId: string;
  profileIds: string[];
  title: string;
  subtitle?: string;
  onClose: () => void;
  onNext: () => void;
}) {
  const insets = useSafeAreaInsets();
  const viewing = useRecordViewing(profileIds);
  const report = useRecordProgress(profileIds);
  const client = useQueryClient();
  const webview = useRef<WebView>(null);
  const started = useRef(false);
  const restored = useRef(false);
  const lastSent = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState<EmbedProgress | null>(null);
  const [completed, setCompleted] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [remaining, setRemaining] = useState(10);
  const latest = useRef({ progress, completed, onNext, report, profileIds });
  latest.current = { progress, completed, onNext, report, profileIds };
  const url = embedPlayerUrl(playback.embed!.url);
  const origin = new URL(url).origin;
  const record = (done: boolean) =>
    viewing.mutate({
      titleId,
      episodeId: playback.episode?.id ?? null,
      completed: done,
    });
  const send = (update: EmbedProgress) =>
    report.mutate({
      titleId,
      episodeId: playback.episode?.id ?? null,
      positionS: update.position,
      durationS: update.duration,
    });
  const next = () => {
    setCancelled(true);
    onNext();
  };

  useEffect(
    () => () => {
      const value = latest.current;
      if (value.progress && !value.completed)
        value.report.mutate({
          titleId,
          episodeId: playback.episode?.id ?? null,
          positionS: value.progress.position,
          durationS: value.progress.duration,
        });
      for (const id of value.profileIds) invalidateAfterWatching(client, id);
    },
    [client, titleId, playback.episode?.id],
  );

  useEffect(() => {
    if (!completed || cancelled || !playback.next) return;
    const deadline = Date.now() + 10_000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        clearInterval(timer);
        setCancelled(true);
        latest.current.onNext();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [completed, cancelled, playback.next]);

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <View style={styles.header}>
        <Button label="Back" variant="ghost" onPress={onClose} />
        <View style={styles.title}>
          <Text variant="headline" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" color="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Button
          label="Reload player"
          variant="ghost"
          onPress={() => {
            setFailed(false);
            restored.current = false;
            setAttempt((value) => value + 1);
          }}
        />
      </View>
      {failed ? (
        <View style={styles.error}>
          <Text>The player didn't load. Try reloading it.</Text>
        </View>
      ) : (
        <WebView
          ref={webview}
          key={attempt}
          source={{ uri: url }}
          style={styles.video}
          originWhitelist={["*"]}
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows
          onOpenWindow={() => undefined}
          injectedJavaScriptBeforeContentLoaded={EMBED_BROWSER_SCRIPT}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
          injectedJavaScript={EMBED_BROWSER_SCRIPT}
          injectedJavaScriptForMainFrameOnly={false}
          onShouldStartLoadWithRequest={(request) =>
            allowEmbedNavigation(request, url)
          }
          onError={() => setFailed(true)}
          onLoad={() => {
            if (!started.current) {
              started.current = true;
              record(false);
            }
          }}
          onMessage={(event) => {
            try {
              if (new URL(event.nativeEvent.url).origin !== origin) return;
            } catch {
              return;
            }
            const update = parseEmbedProgress(
              event.nativeEvent.data,
              playback.embed!.url,
            );
            if (!update) return;
            if (!restored.current) {
              restored.current = true;
              const resume = playback.resume;
              if (
                resume &&
                !resume.completed &&
                resume.positionS >= 30 &&
                resume.positionS < update.duration - 10
              ) {
                webview.current?.injectJavaScript(
                  `document.getElementById('player_iframe')?.contentWindow?.postMessage({player:true,action:'seek${Math.floor(resume.positionS)}'}, new URL(document.getElementById('player_iframe').src).origin); true;`,
                );
                return;
              }
            }
            setProgress(update);
            if (update.status === "completed") {
              setRemaining(10);
              setCompleted(true);
            } else if (
              (update.status === "playing" || update.status === "seeked") &&
              update.position < update.duration - 2
            ) {
              setCompleted(false);
              setCancelled(false);
            }
            const now = Date.now();
            if (
              update.status !== "playing" ||
              now - lastSent.current >= 10_000
            ) {
              lastSent.current = now;
              send(update);
            }
          }}
        />
      )}
      <View style={styles.footer}>
        {progress ? (
          <Text variant="caption" color="muted" style={styles.title}>
            {formatClock(progress.position)} / {formatClock(progress.duration)}
          </Text>
        ) : null}
        <Button
          label={completed ? "Watched" : "Mark watched"}
          variant="ghost"
          disabled={viewing.isPending || completed}
          onPress={() =>
            viewing.mutate(
              {
                titleId,
                episodeId: playback.episode?.id ?? null,
                completed: true,
              },
              {
                onSuccess: () => {
                  setRemaining(10);
                  setCompleted(true);
                  setCancelled(false);
                },
              },
            )
          }
        />
        {playback.next ? (
          <Button
            label="Next episode"
            variant="ghost"
            disabled={viewing.isPending}
            onPress={next}
          />
        ) : null}
      </View>
      {viewing.isError || report.isError ? (
        <Button
          label="Retry save"
          variant="ghost"
          onPress={() => (progress ? send(progress) : record(completed))}
        />
      ) : null}
      {completed && !cancelled && playback.next ? (
        <View
          style={[
            styles.next,
            { right: insets.right + spacing.md, bottom: insets.bottom + 64 },
          ]}
          accessibilityLabel="Next episode"
        >
          <Text variant="headline">
            {playback.next.title ?? `Episode ${playback.next.episode}`}
          </Text>
          <Text variant="caption" color="muted">
            Starts in {remaining} s
          </Text>
          <View style={styles.footer}>
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => setCancelled(true)}
            />
            <Button label="Play now" onPress={next} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.xs,
  },
  title: { flex: 1 },
  video: { flex: 1, backgroundColor: "#000" },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
    padding: spacing.xs,
  },
  next: {
    position: "absolute",
    maxWidth: 340,
    backgroundColor: colors.ink,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  error: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
  },
});
