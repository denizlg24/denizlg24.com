import { SegmentedControl } from "@expo/ui/community/segmented-control";
import { Slider } from "@expo/ui/community/slider";
import { Image } from "expo-image";
import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
} from "expo-image-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  type BodyPhoto,
  type BodyPhotoAngle,
  useBodyPhotos,
  useDeleteBodyPhoto,
  useUploadBodyPhoto,
} from "@/api/body";
import { useProfile } from "@/api/profile";
import { formatShortDate, formatWeight } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { Button, colors, EmptyState, Section, spacing, Text } from "@/ui";
import { confirmDestructive, showActionSheet } from "../shared/action-sheet";
import type { Notice } from "../shared/notice";
import { prepareBodyPhoto } from "./prepare-photo";

const ANGLES: readonly { value: BodyPhotoAngle; label: string }[] = [
  { value: "front", label: "Front" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "back", label: "Back" },
];

export function ProgressPhotos({
  onError,
  onNotice,
}: {
  onError: (error: unknown) => void;
  onNotice: (notice: Notice) => void;
}) {
  const profile = useProfile();
  const weightUnit = profile.data?.weightUnit ?? "kg";
  const [angle, setAngle] = useState<BodyPhotoAngle>("front");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const photos = useBodyPhotos(angle);
  const upload = useUploadBodyPhoto();
  const remove = useDeleteBodyPhoto();

  const list = photos.data ?? [];
  const selected = list.find((photo) => photo.id === selectedId) ?? list[0];
  const selectedIndex = selected ? list.indexOf(selected) : 0;
  const first = list.length > 1 ? list[list.length - 1] : undefined;
  const busy = preparing || upload.isPending;
  const angleLabel = ANGLES.find((entry) => entry.value === angle)?.label ?? "";

  async function capture(source: "camera" | "library") {
    try {
      if (source === "camera") {
        const permission = await requestCameraPermissionsAsync();
        if (!permission.granted) {
          onNotice({
            tone: "info",
            message: "Allow camera access to take progress photos.",
            action: {
              label: "Settings",
              onPress: () => void Linking.openSettings(),
            },
          });
          return;
        }
      }
      const options = {
        mediaTypes: "images" as const,
        quality: 1,
        exif: false,
      };
      const result =
        source === "camera"
          ? await launchCameraAsync(options)
          : await launchImageLibraryAsync(options);
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset) return;

      setPreparing(true);
      const photo = await prepareBodyPhoto(asset);
      setPreparing(false);
      upload.mutate(
        { angle, photo },
        {
          onSuccess: (saved) => {
            haptics.success();
            setSelectedId(saved.id);
          },
          onError,
        },
      );
    } catch (error) {
      setPreparing(false);
      onError(error);
    }
  }

  function addPhoto() {
    showActionSheet({
      title: `${angleLabel} photo`,
      message: "It’s attached to your latest weigh-in.",
      actions: [
        { label: "Take Photo", onPress: () => void capture("camera") },
        {
          label: "Choose from Library",
          onPress: () => void capture("library"),
        },
      ],
    });
  }

  function confirmDelete(photo: BodyPhoto) {
    haptics.light();
    confirmDestructive({
      title: `Delete the ${formatShortDate(photo.logDate)} photo?`,
      message: "The picture is removed from storage for good.",
      confirmLabel: "Delete Photo",
      onConfirm: () => {
        if (selectedId === photo.id) setSelectedId(null);
        remove.mutate(
          { id: photo.id, angle },
          { onSuccess: () => haptics.success(), onError },
        );
      },
    });
  }

  return (
    <Section
      title="Progress photos"
      action={busy ? undefined : { label: "Add", onPress: addPhoto }}
    >
      <View style={styles.stack}>
        <SegmentedControl
          values={ANGLES.map((entry) => entry.label)}
          selectedIndex={ANGLES.findIndex((entry) => entry.value === angle)}
          onChange={(event) => {
            const next = ANGLES[event.nativeEvent.selectedSegmentIndex];
            if (!next) return;
            haptics.selection();
            setAngle(next.value);
            setSelectedId(null);
          }}
        />

        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.secondaryLabel} />
            <Text variant="footnote" tone="secondary">
              {preparing ? "Preparing photo…" : "Uploading…"}
            </Text>
          </View>
        ) : null}

        {photos.data && list.length === 0 && !busy ? (
          <EmptyState
            icon="camera"
            title={`No ${angleLabel.toLowerCase()} photos yet`}
            message="Same spot, light and distance each time keeps them comparable."
          >
            <Button
              label="Add Photo"
              size="regular"
              variant="tinted"
              onPress={addPhoto}
            />
          </EmptyState>
        ) : null}

        {selected ? (
          <View style={styles.compare}>
            {first && first.id !== selected.id ? (
              <PhotoFrame
                photo={first}
                caption="First"
                weightUnit={weightUnit}
                onLongPress={() => confirmDelete(first)}
              />
            ) : null}
            <PhotoFrame
              photo={selected}
              caption={selectedIndex === 0 ? "Latest" : "Selected"}
              weightUnit={weightUnit}
              onLongPress={() => confirmDelete(selected)}
            />
          </View>
        ) : null}

        {list.length > 2 ? (
          <Slider
            value={list.length - 1 - selectedIndex}
            minimumValue={0}
            maximumValue={list.length - 1}
            step={1}
            minimumTrackTintColor={colors.label}
            onValueChange={(value) => {
              const photo = list[list.length - 1 - Math.round(value)];
              if (photo && photo.id !== selected?.id) {
                haptics.selection();
                setSelectedId(photo.id);
              }
            }}
          />
        ) : null}

        {list.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {[...list].reverse().map((photo) => (
              <Pressable
                key={photo.id}
                onPress={() => {
                  haptics.selection();
                  setSelectedId(photo.id);
                }}
                onLongPress={() => confirmDelete(photo)}
                accessibilityRole="button"
                accessibilityLabel={`Photo from ${formatShortDate(photo.logDate)}`}
                accessibilityState={{ selected: photo.id === selected?.id }}
                style={[
                  styles.thumb,
                  photo.id === selected?.id && styles.thumbSelected,
                ]}
              >
                <Image
                  source={{ uri: photo.url, cacheKey: photo.id }}
                  style={styles.thumbImage}
                  contentFit="cover"
                  accessible={false}
                />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {list.length > 0 ? (
          <Text variant="footnote" tone="secondary">
            Touch and hold a photo to delete it.
          </Text>
        ) : null}
      </View>
    </Section>
  );
}

function PhotoFrame({
  photo,
  caption,
  weightUnit,
  onLongPress,
}: {
  photo: BodyPhoto;
  caption: string;
  weightUnit: "kg" | "lb";
  onLongPress: () => void;
}) {
  const label = `${caption} · ${formatShortDate(photo.logDate)} · ${formatWeight(
    photo.weightKg,
    weightUnit,
  )}`;
  return (
    <Pressable
      onLongPress={onLongPress}
      accessibilityLabel={`${photo.angle} progress photo, ${label}`}
      accessibilityHint="Touch and hold to delete"
      style={styles.frame}
    >
      <Image
        source={{ uri: photo.url, cacheKey: photo.id }}
        style={styles.photo}
        contentFit="cover"
        transition={150}
        accessible={false}
      />
      <Text variant="footnote" tone="secondary" figure numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.md,
  },
  busy: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  compare: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  frame: {
    flex: 1,
    gap: spacing.xs,
  },
  photo: {
    width: "100%",
    aspectRatio: 3 / 4,
    backgroundColor: colors.tertiaryFill,
  },
  strip: {
    gap: spacing.xs,
  },
  thumb: {
    paddingBottom: spacing.xs,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  thumbSelected: {
    borderBottomColor: colors.label,
  },
  thumbImage: {
    width: 48,
    height: 64,
    backgroundColor: colors.tertiaryFill,
  },
});
