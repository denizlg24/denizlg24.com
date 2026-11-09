import { type Genre, STREAM_GENRES } from "@repo/schemas/stream";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { X } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, Text } from "@/ui";

/** Netflix's category picker: every genre in a centred list over the page, and a close button. */
export function CategoriesScreen({
  type,
}: {
  type: "movie" | "series" | null;
}) {
  const insets = useSafeAreaInsets();
  const pick = (genre: Genre) => {
    void Haptics.selectionAsync().catch(() => undefined);
    const label =
      type === "series"
        ? `${genre} series`
        : type === "movie"
          ? `${genre} films`
          : genre;
    router.replace({
      pathname: "/browse",
      params: type ? { label, genres: genre, type } : { label, genres: genre },
    });
  };
  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.list,
          {
            paddingTop: insets.top + spacing.xxxl,
            paddingBottom: insets.bottom + 140,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {STREAM_GENRES.map((genre) => (
          <Pressable
            key={genre}
            accessibilityRole="button"
            accessibilityLabel={genre}
            onPress={() => pick(genre)}
            style={({ pressed }) => [
              styles.item,
              { opacity: pressed ? 0.5 : 1 },
            ]}
          >
            <Text variant="heading" color="muted" numberOfLines={1}>
              {genre}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={[styles.closeWrap, { bottom: insets.bottom + spacing.xl }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.close,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <X color={colors.ink} size={28} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "rgba(12,11,10,0.94)" },
  list: { alignItems: "center", gap: spacing.xs },
  item: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  closeWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  close: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
});
