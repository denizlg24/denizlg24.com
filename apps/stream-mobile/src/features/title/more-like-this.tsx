import { Sparkles } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useSimilar } from "@/api/stream";
import { GAP, useRowMetrics } from "@/features/browse/metrics";
import { useAudience } from "@/lib/audience-store";
import { colors, Poster, Skeleton, spacing, Text } from "@/ui";

/** "More like this": three posters to a line. Few enough to lay out without a list. */
export function MoreLikeThis({
  id,
  onOpen,
}: {
  id: string;
  onOpen: (id: string) => void;
}) {
  const { key } = useAudience();
  const similar = useSimilar(id, key);
  const { gridColumn } = useRowMetrics();
  const titles = similar.data?.titles ?? [];

  if (similar.isPending) {
    return (
      <View style={styles.grid}>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton
            key={index}
            style={{ width: gridColumn, height: gridColumn * 1.5 }}
          />
        ))}
      </View>
    );
  }
  if (titles.length === 0) {
    return (
      <View style={styles.empty}>
        <Sparkles color={colors.muted} size={20} />
        <Text variant="footnote" color="muted" style={styles.grow}>
          {similar.isError
            ? "We couldn't load suggestions just now. Try again in a moment."
            : "We're still finding titles like this one. Check back soon."}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.grid}>
      {titles.map((title) => (
        <Pressable
          key={title.id}
          accessibilityRole="button"
          accessibilityLabel={title.title}
          onPress={() => onOpen(title.id)}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Poster title={title} width={gridColumn} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  empty: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  grow: { flex: 1 },
});
