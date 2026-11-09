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
  const [indianCinema, setIndianCinema] = useState(
    existing?.showIndianCinema ?? false,
  );
  const [layout, setLayout] = useState<ProfileLayout>(
    existing?.layout ?? "studio",
  );
  const [genres, setGenres] = useState<Genre[]>(existing?.favoriteGenres ?? []);
  const input = profileInputSchema.safeParse({
    name,
    color,
    kids,
    showIndianCinema: indianCinema,
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
          keyboardAppearance="dark"
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

      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text variant="headline">Larger text</Text>
          <Text variant="footnote" color="muted">
            Bigger writing everywhere in the app, for easier reading.
          </Text>
        </View>
        <Switch
          value={layout === "classic"}
          onValueChange={(on) => setLayout(on ? "classic" : "studio")}
          trackColor={{ true: colors.amber, false: colors.raised }}
          accessibilityLabel="Larger text"
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

      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text variant="headline">Show Bollywood and Indian films</Text>
          <Text variant="footnote" color="muted">
            Films and series in Hindi, Tamil, Telugu and other Indian languages.
            They only appear when everyone watching has this on.
          </Text>
        </View>
        <Switch
          value={indianCinema}
          onValueChange={setIndianCinema}
          trackColor={{ true: colors.amber, false: colors.raised }}
          accessibilityLabel="Show Bollywood and Indian films"
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

const styles = StyleSheet.create({
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
