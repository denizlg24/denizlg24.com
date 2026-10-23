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
  large,
  hide = [],
  style,
}: {
  facts: TitleFacts;
  /** Classic's 20 pt. */
  large?: boolean;
  hide?: (keyof TitleFacts)[];
  style?: ViewStyle;
}) {
  const variant: TypeVariant = large ? "classicBody" : "subheadline";
  const shown = (key: keyof TitleFacts) => !hide.includes(key) && facts[key];
  return (
    <View style={[styles.row, large ? styles.large : null, style]}>
      {shown("rating") ? (
        <Rating value={facts.rating ?? ""} large={large} />
      ) : null}
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
          <Text variant={large ? "classicLabel" : "caption"} color="muted">
            {facts.certification}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function Rating({ value, large }: { value: string; large?: boolean }) {
  return (
    <View
      style={styles.rating}
      accessible
      accessibilityLabel={`Rated ${value} out of 10`}
    >
      <Star
        size={large ? 20 : 14}
        color={colors.amber}
        fill={colors.amber}
        strokeWidth={1.5}
      />
      <Text variant={large ? "classicLabel" : "callout"}>{value}</Text>
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
  large: { columnGap: spacing.lg },
  rating: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  badge: {
    borderWidth: 1,
    borderColor: colors.muted,
    borderRadius: radius.poster,
    paddingHorizontal: spacing.xs + 1,
  },
});
