import { router, useFocusEffect } from "expo-router";
import { MonitorUp, RotateCcw } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { z } from "zod";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { colors, spacing } from "@/ui";
import { CONTENT_X, TV_SAFE } from "./layout";
import { TvShell } from "./shell";
import { TvButton } from "./tv-button";
import { TvText } from "./tv-text";

const pairing = z.object({ receiverKey: z.string().regex(/^[\w-]{43}$/) });
const receiverUrl = `${API_URL}/screen/receive`;

export function TvScreenShare() {
  const [attempt, setAttempt] = useState(0);
  const [key, setKey] = useState<string>();
  const [issue, setIssue] = useState<"unavailable" | "ended">();
  const [playing, setPlaying] = useState(false);
  const unavailable = useCallback(() => setIssue("unavailable"), []);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      setKey(undefined);
      setIssue(undefined);
      setPlaying(false);
      let shareKey: string | undefined;
      const close = (key: string) => {
        void fetch(`${API_URL}/api/public/screen-share`, {
          method: "DELETE",
          headers: { Authorization: `Cast ${key}` },
        }).catch(() => undefined);
      };
      void api("screen-share", pairing, {
        method: "POST",
        signal: controller.signal,
      })
        .then(({ receiverKey }) => {
          if (controller.signal.aborted) close(receiverKey);
          else {
            shareKey = receiverKey;
            setKey(receiverKey);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setIssue("unavailable");
        });
      return () => {
        controller.abort();
        if (shareKey) close(shareKey);
      };
    }, [attempt]),
  );

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  return (
    <TvShell
      section="screen"
      hideRail={playing && !issue}
      onBack={() => {
        if (!key || issue) return false;
        router.replace("/tv");
        return true;
      }}
    >
      {key && !issue ? (
        <View
          style={playing ? styles.fullscreen : styles.receiver}
          pointerEvents="none"
        >
          <WebView
            source={{ uri: `${receiverUrl}#${key}` }}
            originWhitelist={[new URL(API_URL).origin]}
            onShouldStartLoadWithRequest={({ url }) =>
              url === receiverUrl || url === `${receiverUrl}#${key}`
            }
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            focusable={false}
            setSupportMultipleWindows={false}
            style={styles.surface}
            onMessage={({ nativeEvent }) => {
              if (nativeEvent.data === "playing") setPlaying(true);
              if (nativeEvent.data === "ended") setIssue("ended");
            }}
            onError={unavailable}
            onHttpError={unavailable}
            onRenderProcessGone={unavailable}
          />
        </View>
      ) : (
        <View style={styles.content}>
          <MonitorUp size={28} color={colors.amber} />
          <TvText variant="heading">Screen Share</TvText>
          {issue ? (
            <>
              <TvText variant="lede" color="muted">
                {issue === "ended"
                  ? "Screen sharing ended or the code expired."
                  : "Stream couldn’t connect. Try again."}
              </TvText>
              <TvButton
                label="Get a new TV code"
                icon={RotateCcw}
                preferred
                onPress={retry}
              />
            </>
          ) : (
            <ActivityIndicator
              size="large"
              color={colors.amber}
              accessibilityLabel="Getting your TV code"
            />
          )}
        </View>
      )}
    </TvShell>
  );
}

const styles = StyleSheet.create({
  fullscreen: { flex: 1 },
  receiver: { flex: 1, marginLeft: CONTENT_X, marginRight: TV_SAFE.x },
  surface: { backgroundColor: colors.ink },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
});
