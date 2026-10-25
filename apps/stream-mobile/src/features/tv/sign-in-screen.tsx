import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { session } from "@/lib/auth";
import { Button, colors, fonts, spacing, Text, Wordmark } from "@/ui";
import { TV_SAFE } from "./layout";
import { QrCode } from "./qr-code";

type Phase =
  | { step: "asking" }
  | {
      step: "waiting";
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string | null;
    }
  | { step: "failed"; message: string };

/** `ABCDEFGH` reads as two groups of four, the way the phone page shows it. */
function grouped(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/** `https://auth.denizlg24.com/device` as people type it. */
function typed(uri: string): string {
  return uri.replace(/^https?:\/\//, "");
}

/**
 * A TV has no browser and no keyboard worth using, so it signs in with a
 * code: someone approves it on their phone and this screen notices.
 */
export function TvSignInScreen() {
  const [phase, setPhase] = useState<Phase>({ step: "asking" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setPhase({ step: "asking" });
    void (async () => {
      try {
        const device = await session.startDeviceSignIn();
        if (controller.signal.aborted) return;
        setPhase({
          step: "waiting",
          userCode: device.userCode,
          verificationUri: device.verificationUri,
          verificationUriComplete: device.verificationUriComplete ?? null,
        });
        await device.complete(controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        setPhase({
          step: "failed",
          message: session.describeError(error),
        });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  return (
    <View style={styles.screen}>
      <Wordmark size={34} />
      {phase.step === "waiting" ? (
        <View style={styles.body}>
          <View style={styles.copy}>
            <Text variant="hero">Sign in with your phone</Text>
            <Text variant="lede" color="muted">
              On your phone, go to {typed(phase.verificationUri)} and enter this
              code. Sign in there with your Stream account if it asks.
            </Text>
            <Text style={styles.code} accessibilityLabel={phase.userCode}>
              {grouped(phase.userCode)}
            </Text>
            <View style={styles.waiting}>
              <ActivityIndicator color={colors.muted} />
              <Text variant="body" color="muted">
                Waiting for your phone. This screen moves on by itself.
              </Text>
            </View>
          </View>
          {phase.verificationUriComplete ? (
            <View style={styles.scan}>
              <QrCode value={phase.verificationUriComplete} size={200} />
              <Text variant="body" color="muted" style={styles.scanLabel}>
                Or point your phone's camera here. The code is filled in for
                you.
              </Text>
            </View>
          ) : null}
        </View>
      ) : phase.step === "failed" ? (
        <View style={styles.copy}>
          <Text variant="hero">That didn't work</Text>
          <Text variant="lede" color="muted">
            {phase.message}
          </Text>
          <View style={styles.action}>
            <Button
              label="Get a new code"
              size="large"
              preferred
              onPress={retry}
            />
          </View>
        </View>
      ) : (
        <View style={styles.copy}>
          <ActivityIndicator color={colors.muted} size="large" />
          <Text variant="lede" color="muted">
            Getting a sign-in code…
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ink,
    paddingHorizontal: TV_SAFE.x,
    paddingVertical: TV_SAFE.y + spacing.lg,
    gap: spacing.xxxl,
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxxl * 2,
  },
  copy: { flex: 1, gap: spacing.xl, justifyContent: "center" },
  code: {
    fontFamily: fonts.display,
    fontSize: 72,
    lineHeight: 72,
    color: colors.amber,
  },
  waiting: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  scan: { width: 240, alignItems: "center", gap: spacing.lg },
  scanLabel: { textAlign: "center" },
  action: { flexDirection: "row" },
});
