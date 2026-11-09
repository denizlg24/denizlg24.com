import { Star } from "lucide-react-native";
import { StyleSheet, View, type ViewStyle } from "react-native";
import type { TitleFacts } from "@/lib/format";
import { Text } from "./text";
import { colors, radius, spacing, type TypeVariant } from "./theme";

/**
 * Rating (a filled amber star), kind, years, runtime and an outlined
 * certification badge, separated by space alone.
 */
export function MetaRow({
  facts,
  hide = [],
  style,
}: {
  facts: TitleFacts;
  hide?: (keyof TitleFacts)[];
  style?: ViewStyle;
}) {
  const variant: TypeVariant = "subheadline";
  const shown = (key: keyof TitleFacts) => !hide.includes(key) && facts[key];
  return (
    <View style={[styles.row, style]}>
      {shown("rating") ? <Rating value={facts.rating ?? ""} /> : null}
      {shown("kind") ? <Text variant={variant}>{facts.kind}</Text> : null}
      {shown("years") ? (
        <Text variant={variant} color="muted">
          {facts.years}
        </Text>
      ) : null}
      {shown("runtime") ? (
        <Text variant={variant} color="muted">
          {facts.runtime}
        </Text>
      ) : null}
      {shown("certification") ? (
        <View style={styles.badge}>
          <Text variant="caption" color="muted">
            {facts.certification}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function Rating({ value }: { value: string }) {
  return (
    // The label sits on the text: an `accessible` View is a stop for a TV
    // remote's focus on Android, and this one has nothing to press.
    <View style={styles.rating}>
      <Star
        size={14}
        color={colors.amber}
        fill={colors.amber}
        strokeWidth={1.5}
      />
      <Text variant="callout" accessibilityLabel={`Rated ${value} out of 10`}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: spacing.md,
    rowGap: spacing.xs,
  },
  rating: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  badge: {
    borderWidth: 1,
    borderColor: colors.muted,
    borderRadius: radius.poster,
    paddingHorizontal: spacing.xs + 1,
  },
});
