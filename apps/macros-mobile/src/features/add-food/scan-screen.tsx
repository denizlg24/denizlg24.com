import { useQueryClient } from "@tanstack/react-query";
import { type BarcodeScanningResult, CameraView } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { foodKeys, lookupBarcode } from "@/api/foods";
import { errorMessage } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import type { LogTimeParams } from "@/lib/log-time";
import { Button, colors, Icon, type IconName, spacing, Text } from "@/ui";
import { isPlausibleBarcode } from "./barcode";
import { CameraPermissionGate } from "./components/camera-permission";
import { CameraStatus } from "./components/camera-status";
import { forwardedTimeParams, useZone } from "./target";

type ScanState =
  | { kind: "scanning" }
  | { kind: "looking-up"; code: string }
  | { kind: "not-found"; code: string }
  | { kind: "error"; code: string; message: string };

const BARCODE_TYPES = ["ean13", "ean8", "upc_a", "upc_e"] as const;

function RoundButton({
  icon,
  label,
  onPress,
  active = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.round,
        active && styles.roundActive,
        pressed && styles.pressed,
      ]}
    >
      <Icon
        name={icon}
        size={18}
        weight="semibold"
        color={active ? "#000000" : "#ffffff"}
      />
    </Pressable>
  );
}

export function ScanScreen() {
  const params = useLocalSearchParams();
  const zone = useZone();
  const [forward] = useState(() => forwardedTimeParams(params, zone.today));

  return (
    <CameraPermissionGate
      purpose="scan barcodes"
      fallback={{ label: "Search by name", onPress: () => router.back() }}
      onClose={() => router.back()}
    >
      <Scanner timeParams={forward} />
    </CameraPermissionGate>
  );
}

function Scanner({ timeParams: forward }: { timeParams: LogTimeParams }) {
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [state, setState] = useState<ScanState>({ kind: "scanning" });
  const [torch, setTorch] = useState(false);
  const lookup = useRef<AbortController | null>(null);

  useEffect(() => () => lookup.current?.abort(), []);

  const regionWidth = Math.min(width - spacing.xxxl * 2, 360);
  const regionHeight = Math.round(regionWidth * 0.55);

  async function resolve(code: string) {
    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    setState({ kind: "looking-up", code });
    try {
      const detail = await lookupBarcode(code, controller.signal);
      if (controller.signal.aborted) return;
      if (!detail) {
        haptics.warning();
        setState({ kind: "not-found", code });
        return;
      }
      // The sheet opens on data it already has instead of fetching it again.
      queryClient.setQueryData(foodKeys.detail(detail.item.id), detail);
      router.replace({
        pathname: "/food/[id]",
        params: { id: detail.item.id, name: detail.item.name, ...forward },
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      haptics.error();
      setState({ kind: "error", code, message: errorMessage(error) });
    }
  }

  // The camera keeps delivering reads until the re-render detaches the
  // handler; this closes the gate synchronously on the first good one.
  const accepting = useRef(true);

  function onScanned(result: BarcodeScanningResult) {
    if (!accepting.current) return;
    const code = result.data.trim();
    if (!isPlausibleBarcode(code, result.type)) return;
    accepting.current = false;
    haptics.impact();
    void resolve(code);
  }

  function scanAgain() {
    accepting.current = true;
    setState({ kind: "scanning" });
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={state.kind === "scanning" ? onScanned : undefined}
      />

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={styles.shade} />
        <View style={{ flexDirection: "row", height: regionHeight }}>
          <View style={styles.shade} />
          <View
            style={[
              styles.region,
              { width: regionWidth, height: regionHeight },
              state.kind === "looking-up" && styles.regionLocked,
            ]}
          />
          <View style={styles.shade} />
        </View>
        <View style={[styles.shade, styles.below]}>
          <Text variant="subheadline" align="center" style={styles.onCamera}>
            {state.kind === "looking-up"
              ? `Looking up ${state.code}…`
              : "Hold a barcode inside the frame"}
          </Text>
        </View>
      </View>

      <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
        <RoundButton icon="x" label="Close" onPress={() => router.back()} />
        <CameraStatus />
        <RoundButton
          icon={torch ? "flashlight" : "flashlight-off"}
          label={torch ? "Turn torch off" : "Turn torch on"}
          active={torch}
          onPress={() => {
            haptics.selection();
            setTorch((current) => !current);
          }}
        />
      </View>

      {state.kind === "looking-up" ? (
        <View style={[styles.status, { bottom: insets.bottom + spacing.xxl }]}>
          <ActivityIndicator color="#ffffff" />
        </View>
      ) : null}

      {state.kind === "not-found" || state.kind === "error" ? (
        <View
          style={[styles.panel, { paddingBottom: insets.bottom + spacing.lg }]}
        >
          <Text variant="headline">
            {state.kind === "not-found"
              ? "Not in the database yet"
              : "Couldn’t look that up"}
          </Text>
          <Text variant="subheadline" tone="secondary">
            {state.kind === "not-found"
              ? `Nobody has added ${state.code}. Photograph its nutrition label and it will be ready for next time.`
              : state.message}
          </Text>
          <View style={styles.panelActions}>
            {state.kind === "not-found" ? (
              <>
                <Button
                  label="Scan nutrition label"
                  icon="scan-text"
                  onPress={() =>
                    router.replace({
                      pathname: "/label",
                      params: { barcode: state.code, ...forward },
                    })
                  }
                />
                <Button
                  label="Enter it yourself"
                  variant="tinted"
                  onPress={() =>
                    router.replace({
                      pathname: "/create-food",
                      params: { barcode: state.code, ...forward },
                    })
                  }
                />
              </>
            ) : (
              <Button
                label="Try again"
                onPress={() => void resolve(state.code)}
              />
            )}
            <View style={styles.row}>
              <Button
                label="Scan another"
                variant="plain"
                size="regular"
                block={false}
                onPress={scanAgain}
              />
              <Button
                label="Search instead"
                variant="plain"
                size="regular"
                block={false}
                onPress={() => router.back()}
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const SHADE = "rgba(0,0,0,0.55)";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  shade: {
    flex: 1,
    backgroundColor: SHADE,
  },
  below: {
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  region: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
  },
  regionLocked: {
    borderColor: "#ffffff",
    borderWidth: 3,
  },
  onCamera: {
    color: "#ffffff",
  },
  topBar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  roundActive: {
    backgroundColor: "#ffffff",
  },
  pressed: {
    opacity: 0.7,
  },
  status: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.sm,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: colors.background,
  },
  panelActions: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
