import { type AppRelease, appReleaseSchema } from "@repo/schemas/stream";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as SecureStore from "expo-secure-store";
import { Download } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CHECK_EVERY_MS,
  formatSize,
  SNOOZE_MS,
  shouldOffer,
} from "@/lib/app-update";
import { API_URL } from "@/lib/config";
import { Button, Text } from "@/ui";
import { colors, radius, spacing } from "@/ui/theme";

const SNOOZE_KEY = "stream.update.snoozed";
const APK_MIME = "application/vnd.android.package-archive";
const FLAG_GRANT_READ_URI_PERMISSION = 1;

type Phase =
  | { kind: "idle" }
  | { kind: "offer"; release: AppRelease }
  | { kind: "downloading"; release: AppRelease; progress: number }
  | { kind: "failed"; release: AppRelease };

async function readSnooze(): Promise<{
  version: string;
  until: number;
} | null> {
  const raw = await SecureStore.getItemAsync(SNOOZE_KEY).catch(() => null);
  if (!raw) return null;
  const [version, until] = raw.split("|");
  const at = Number(until);
  return version && Number.isFinite(at) ? { version, until: at } : null;
}

async function fetchLatest(): Promise<AppRelease | null> {
  const response = await fetch(`${API_URL}/api/public/app/android`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const parsed = appReleaseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

async function installApk(
  release: AppRelease,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const target = `${FileSystem.cacheDirectory}Stream-${release.version}.apk`;
  const existing = await FileSystem.getInfoAsync(target);
  if (
    !existing.exists ||
    (release.sizeBytes !== null && existing.size !== release.sizeBytes)
  ) {
    const download = FileSystem.createDownloadResumable(
      release.url,
      target,
      {},
      ({
        totalBytesWritten,
        totalBytesExpectedToWrite,
      }: FileSystem.DownloadProgressData) => {
        const total = totalBytesExpectedToWrite || release.sizeBytes || 0;
        if (total > 0) onProgress(Math.min(1, totalBytesWritten / total));
      },
    );
    const result = await download.downloadAsync();
    if (result?.status !== 200) {
      await FileSystem.deleteAsync(target, { idempotent: true });
      throw new Error(`download failed: ${result?.status ?? "no result"}`);
    }
  }
  const contentUri = await FileSystem.getContentUriAsync(target);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: APK_MIME,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

/**
 * Android only: the APK is installed by hand, so the app looks for a newer
 * signed release on launch and every few hours, and offers to fetch it and
 * hand it to the system installer. Phones and Google TV share it.
 */
export function UpdatePrompt() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const lastCheck = useRef(0);
  const insets = useSafeAreaInsets();
  const installed = Constants.expoConfig?.version ?? "0.0.0";

  const check = useCallback(async () => {
    if (Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
    lastCheck.current = Date.now();
    try {
      const [release, snoozed] = await Promise.all([
        fetchLatest(),
        readSnooze(),
      ]);
      if (
        release &&
        shouldOffer({
          installed,
          latest: release.version,
          snoozed,
          now: Date.now(),
        })
      ) {
        setPhase((current) =>
          current.kind === "idle" ? { kind: "offer", release } : current,
        );
      }
    } catch {
      lastCheck.current = 0;
    }
  }, [installed]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => subscription.remove();
  }, [check]);

  if (phase.kind === "idle") return null;
  const { release } = phase;
  const size = formatSize(release.sizeBytes);

  const later = () => {
    void SecureStore.setItemAsync(
      SNOOZE_KEY,
      `${release.version}|${Date.now() + SNOOZE_MS}`,
    ).catch(() => {});
    setPhase({ kind: "idle" });
  };

  const update = () => {
    setPhase({ kind: "downloading", release, progress: 0 });
    installApk(release, (progress) =>
      setPhase({ kind: "downloading", release, progress }),
    )
      .then(() => setPhase({ kind: "offer", release }))
      .catch(() => setPhase({ kind: "failed", release }));
  };

  const tv = Platform.isTV;
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.layer,
        tv ? styles.layerTv : { paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <View style={[styles.card, tv && styles.cardTv]}>
        <View style={styles.heading}>
          <Download color={colors.amber} size={tv ? 28 : 20} />
          <Text
            variant={tv ? "title" : "headline"}
            numberOfLines={1}
            style={styles.flex}
          >
            Stream {release.version} is ready
          </Text>
        </View>
        <Text variant="callout" color="muted" numberOfLines={tv ? 4 : 3}>
          {phase.kind === "failed"
            ? "The download didn't finish. Check the connection and try again."
            : phase.kind === "downloading"
              ? `Downloading${size ? ` ${size}` : ""}… ${Math.round(phase.progress * 100)}%. Android will then ask you to confirm the update.`
              : `A newer version of the app is available${size ? ` (${size})` : ""}. Updating keeps your profiles and sign-in.`}
        </Text>
        {phase.kind === "downloading" ? (
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(phase.progress * 100)}%` },
              ]}
            />
          </View>
        ) : (
          <View style={styles.actions}>
            <View style={styles.flex}>
              <Button
                label={phase.kind === "failed" ? "Try again" : "Update now"}
                onPress={update}
                preferred
                block
              />
            </View>
            <View style={styles.flex}>
              <Button label="Later" variant="secondary" onPress={later} block />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.lg,
  },
  layerTv: {
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    backgroundColor: colors.raised,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTv: { width: 640, padding: spacing.xl },
  heading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flex: { flex: 1 },
  actions: { flexDirection: "row", gap: spacing.sm },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairline,
    overflow: "hidden",
  },
  fill: { height: 4, backgroundColor: colors.amber },
});
