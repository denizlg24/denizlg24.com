import type { MacrosVisionLabelFormat } from "@repo/schemas/macros";
import { CameraView } from "expo-camera";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";
import { getLocales } from "expo-localization";
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
import { isVisionUnavailable, parseNutritionLabel } from "@/api/vision";
import { errorMessage, NetworkError } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { Button, colors, Icon, type IconName, spacing, Text } from "@/ui";
import { SegmentedControl } from "@/ui/segmented-control";
import { CameraPermissionGate } from "./components/camera-permission";
import { type CropRect, guideCrop, type Size } from "./label-crop";
import { putLabelDraft } from "./label-draft";
import { forwardedTimeParams, readParam, useZone } from "./target";

/** Long edge sent to the label reader. */
const MAX_EDGE = 1800;

type LabelState =
  | { kind: "capture" }
  | { kind: "reading"; uri: string }
  | { kind: "failed"; uri: string; message: string; unavailable: boolean };

interface Photo {
  uri: string;
  width: number;
  height: number;
}

function defaultLabelFormat(): MacrosVisionLabelFormat {
  return getLocales()[0]?.regionCode === "US" ? "us" : "eu";
}

async function prepare(photo: Photo, crop: CropRect | null): Promise<string> {
  const context = ImageManipulator.manipulate(photo.uri);
  if (crop) context.crop(crop);
  const width = crop?.width ?? photo.width;
  const height = crop?.height ?? photo.height;
  if (Math.max(width, height) > MAX_EDGE) {
    context.resize(
      width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE },
    );
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    compress: 0.85,
    format: SaveFormat.JPEG,
  });
  image.release();
  context.release();
  return saved.uri;
}

function RoundButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.round, pressed && styles.pressed]}
    >
      <Icon name={icon} size={18} weight="semibold" color="#ffffff" />
    </Pressable>
  );
}

export function LabelScreen() {
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { today } = useZone();
  const barcode = readParam(params.barcode);
  const forward: Record<string, string> = {
    ...(barcode ? { barcode } : {}),
    ...forwardedTimeParams(params, today),
  };

  const regionWidth = Math.min(width - spacing.xxl * 2, 380);
  const regionHeight = Math.min(Math.round(regionWidth * 1.25), height * 0.5);

  const [state, setState] = useState<LabelState>({ kind: "capture" });
  const [labelFormat, setLabelFormat] = useState(defaultLabelFormat);
  const [capturing, setCapturing] = useState(false);
  const camera = useRef<CameraView>(null);
  const request = useRef<AbortController | null>(null);
  const viewSize = useRef<Size>({ width: 0, height: 0 });
  const frameTop = useRef(0);

  useEffect(() => () => request.current?.abort(), []);

  function enterManually() {
    request.current?.abort();
    router.replace({ pathname: "/create-food", params: forward });
  }

  async function read(photo: Photo, crop: CropRect | null) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: "reading", uri: photo.uri });
    try {
      const uri = await prepare(photo, crop);
      const label = await parseNutritionLabel(
        { uri, labelFormat },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const read = Object.values(label.fields).filter(
        (field) => field.value != null,
      ).length;
      if (read < 2) {
        haptics.warning();
        setState({
          kind: "failed",
          uri: photo.uri,
          unavailable: false,
          message:
            "Couldn’t read enough of the label. Keep it flat, well lit and in focus, with the whole table in the frame.",
        });
        return;
      }
      haptics.success();
      putLabelDraft({ label, labelFormat });
      router.replace({
        pathname: "/create-food",
        params: { ...forward, draft: "label" },
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      haptics.error();
      const unavailable = isVisionUnavailable(error);
      setState({
        kind: "failed",
        uri: photo.uri,
        unavailable,
        message: unavailable
          ? "Label reading is unavailable right now. Enter the values from the package instead."
          : error instanceof NetworkError
            ? "You’re offline. Label reading needs a connection — you can still enter the values yourself."
            : `Couldn’t read the label. ${errorMessage(error)}`,
      });
    }
  }

  async function takePhoto() {
    if (capturing || !camera.current) return;
    setCapturing(true);
    try {
      haptics.light();
      const photo = await camera.current.takePictureAsync({ quality: 0.9 });
      const frame = {
        x: (viewSize.current.width - regionWidth) / 2,
        y: frameTop.current,
        width: regionWidth,
        height: regionHeight,
      };
      await read(photo, guideCrop(photo, viewSize.current, frame));
    } catch (error) {
      haptics.error();
      setState({
        kind: "failed",
        uri: "",
        unavailable: false,
        message: `Couldn’t take the photo. ${errorMessage(error)}`,
      });
    } finally {
      setCapturing(false);
    }
  }

  async function pickPhoto() {
    const result = await launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset) await read(asset, null);
  }

  if (state.kind !== "capture") {
    return (
      <View
        style={[
          styles.review,
          {
            paddingTop: insets.top + spacing.sm,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <View style={styles.topBar}>
          <RoundButton icon="x" label="Close" onPress={() => router.back()} />
        </View>
        {state.uri ? (
          <Image
            source={{ uri: state.uri }}
            style={[styles.preview, state.kind === "reading" && styles.dimmed]}
            contentFit="contain"
            accessibilityLabel="The nutrition label photo"
          />
        ) : (
          <View style={styles.preview} />
        )}
        {state.kind === "reading" ? (
          <View style={styles.reading}>
            <ActivityIndicator color="#ffffff" />
            <Text variant="subheadline" style={styles.onCamera}>
              Reading the label…
            </Text>
          </View>
        ) : (
          <View style={styles.panel}>
            <Text variant="subheadline">{state.message}</Text>
            <View style={styles.panelActions}>
              {state.unavailable ? (
                <Button label="Enter it yourself" onPress={enterManually} />
              ) : (
                <>
                  <Button
                    label="Retake"
                    icon="camera"
                    onPress={() => setState({ kind: "capture" })}
                  />
                  <Button
                    label="Enter it yourself"
                    variant="tinted"
                    onPress={enterManually}
                  />
                </>
              )}
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <CameraPermissionGate
      purpose="photograph nutrition labels"
      fallback={{
        label: "Choose a photo instead",
        onPress: () => void pickPhoto(),
      }}
      onClose={() => router.back()}
    >
      <View
        style={styles.container}
        onLayout={({ nativeEvent }) => {
          viewSize.current = {
            width: nativeEvent.layout.width,
            height: nativeEvent.layout.height,
          };
        }}
      >
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
        />

        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={styles.shade} />
          <View
            style={{ flexDirection: "row", height: regionHeight }}
            onLayout={({ nativeEvent }) => {
              frameTop.current = nativeEvent.layout.y;
            }}
          >
            <View style={styles.shade} />
            <View
              style={[
                styles.region,
                { width: regionWidth, height: regionHeight },
              ]}
            />
            <View style={styles.shade} />
          </View>
          <View style={[styles.shade, styles.hint]}>
            <Text variant="subheadline" align="center" style={styles.onCamera}>
              Fit the whole nutrition table in the frame
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.topBar,
            styles.floating,
            { top: insets.top + spacing.sm },
          ]}
        >
          <RoundButton icon="x" label="Close" onPress={() => router.back()} />
          <View style={styles.format}>
            <SegmentedControl
              values={["EU label", "US label"]}
              selectedIndex={labelFormat === "eu" ? 0 : 1}
              appearance="dark"
              onChange={({ nativeEvent }) => {
                haptics.selection();
                setLabelFormat(
                  nativeEvent.selectedSegmentIndex === 1 ? "us" : "eu",
                );
              }}
            />
          </View>
          <RoundButton
            icon="square-pen"
            label="Enter values yourself"
            onPress={enterManually}
          />
        </View>

        <View style={[styles.controls, { bottom: insets.bottom + spacing.xl }]}>
          <RoundButton
            icon="images"
            label="Choose a photo"
            onPress={() => void pickPhoto()}
          />
          <Pressable
            onPress={() => void takePhoto()}
            disabled={capturing}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            style={({ pressed }) => [
              styles.shutter,
              (pressed || capturing) && styles.pressed,
            ]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.round} />
        </View>
      </View>
    </CameraPermissionGate>
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
  hint: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  region: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
  },
  onCamera: {
    color: "#ffffff",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  floating: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  format: {
    flex: 1,
    maxWidth: 220,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  pressed: {
    opacity: 0.6,
  },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#ffffff",
  },
  review: {
    flex: 1,
    backgroundColor: "#000000",
    gap: spacing.lg,
  },
  preview: {
    flex: 1,
  },
  dimmed: {
    opacity: 0.5,
  },
  reading: {
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  panel: {
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    padding: spacing.xl,
    borderRadius: 16,
    backgroundColor: colors.background,
  },
  panelActions: {
    gap: spacing.sm,
  },
});
