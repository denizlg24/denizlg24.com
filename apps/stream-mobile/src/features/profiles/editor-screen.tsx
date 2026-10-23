import {
  type Genre,
  type ProfileColor,
  type ProfileLayout,
  profileInputSchema,
  STREAM_GENRES,
} from "@repo/schemas/stream";
import { router } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDeleteProfile, useMe, useSaveProfile } from "@/api/stream";
import { NetworkError } from "@/lib/api";
import { seatAudience, useAudienceIds } from "@/lib/audience-store";
import { toggleGenre } from "@/lib/title-query";
import {
  Avatar,
  Button,
  Chip,
  colors,
  gutter,
  radius,
  spacing,
  Text,
} from "@/ui";
import { ColorPicker } from "./color-picker";

const MAX_GENRES = 6;

/** Add a profile (no `id`) or edit one. */
export function EditorScreen({ id }: { id: string | null }) {
  const insets = useSafeAreaInsets();
  const me = useMe();
  const seated = useAudienceIds();
  const existing = id ? me.data?.profiles.find((p) => p.id === id) : undefined;
  const save = useSaveProfile();
  const remove = useDeleteProfile();

  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState<ProfileColor>(existing?.color ?? "tide");
  const [kids, setKids] = useState(existing?.kids ?? false);
  const [layout, setLayout] = useState<ProfileLayout>(
    existing?.layout ?? "studio",
  );
  const [genres, setGenres] = useState<Genre[]>(existing?.favoriteGenres ?? []);
  const input = profileInputSchema.safeParse({
    name,
    color,
    kids,
    layout,
    favoriteGenres: genres,
  });

  const failure = save.error ?? remove.error;
  const error = failure
    ? failure instanceof NetworkError
      ? "We couldn't reach Stream. Check your connection and try again."
      : "That didn't save. Please try again."
    : null;

  const confirmDelete = () => {
    if (!existing) return;
    Alert.alert(
      `Delete ${existing.name}?`,
      "Their list, progress and suggestions go with it. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            remove.mutate(existing.id, {
              onSuccess: () => {
                if (seated?.includes(existing.id)) {
                  seatAudience(seated.filter((seat) => seat !== existing.id));
                }
                router.back();
              },
            }),
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.raised }}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + spacing.xxl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="title">{existing ? "Edit profile" : "New profile"}</Text>
      <View style={styles.nameRow}>
        <Avatar name={name || "?"} color={color} size={56} />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={colors.faint}
          maxLength={24}
          autoCapitalize="words"
          accessibilityLabel="Profile name"
          style={[
            styles.input,
            { color: colors.paper, backgroundColor: colors.fill },
          ]}
        />
      </View>

      <Text variant="label" color="muted">
        Colour
      </Text>
      <ColorPicker value={color} onChange={setColor} />

      <Text variant="label" color="muted">
        Layout
      </Text>
      <View style={styles.layouts} accessibilityRole="radiogroup">
        <LayoutOption
          title="Full layout"
          detail="Tonight's picks, dials for browsing and the map. Several people can watch together."
          selected={layout === "studio"}
          onPress={() => setLayout("studio")}
        />
        <LayoutOption
          title="Simple layout with bigger text"
          detail="Large writing and big buttons: Home, Search and My list. Nothing new to learn."
          selected={layout === "classic"}
          onPress={() => setLayout("classic")}
        />
      </View>

      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text variant="headline">Kids profile</Text>
          <Text variant="footnote" color="muted">
            Only shows films and series rated for children.
          </Text>
        </View>
        <Switch
          value={kids}
          onValueChange={setKids}
          trackColor={{ true: colors.amber, false: colors.raised }}
          accessibilityLabel="Kids profile"
        />
      </View>

      <Text variant="label" color="muted">
        Favourite genres
      </Text>
      <Text variant="footnote" color="muted">
        Pick up to {MAX_GENRES}. They help us suggest things you'll enjoy.
      </Text>
      <View style={styles.wrap}>
        {STREAM_GENRES.map((genre) => {
          const selected = genres.includes(genre);
          return (
            <Chip
              key={genre}
              label={genre}
              selected={selected}
              disabled={!selected && genres.length >= MAX_GENRES}
              onPress={() => setGenres(toggleGenre(genres, genre))}
            />
          );
        })}
      </View>

      {error ? (
        <Text variant="subheadline" color="danger">
          {error}
        </Text>
      ) : null}
      <Button
        label={existing ? "Save" : "Add profile"}
        size="large"
        block
        disabled={!input.success}
        loading={save.isPending}
        onPress={() => {
          if (!input.success) return;
          save.mutate(
            { id: existing?.id ?? null, input: input.data },
            { onSuccess: () => router.back() },
          );
        }}
      />
      {existing ? (
        <Button
          label="Delete profile"
          variant="destructive"
          block
          loading={remove.isPending}
          onPress={confirmDelete}
        />
      ) : null}
    </ScrollView>
  );
}

function LayoutOption({
  title,
  detail,
  selected,
  onPress,
}: {
  title: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: selected ? colors.lifted : "transparent",
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={[styles.radio, selected ? styles.radioOn : null]} />
      <View style={styles.grow}>
        <Text variant="headline">{title}</Text>
        <Text variant="footnote" color="muted">
          {detail}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layouts: { gap: spacing.xs },
  option: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.muted,
    marginTop: 1,
  },
  radioOn: { borderColor: colors.amber, borderWidth: 6 },
  content: { padding: gutter, gap: spacing.lg },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  input: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    fontSize: 17,
  },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  grow: { flex: 1, gap: spacing.xxs },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
