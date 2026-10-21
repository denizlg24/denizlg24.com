import type { MacrosRecipeSummary } from "@repo/schemas/macros";
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { FoodIcon } from "@/components/food-icon";
import { RecipePhoto } from "@/components/recipe-photo";
import {
  type EnergyUnit,
  energyLabel,
  formatEnergy,
  formatGrams,
} from "@/lib/format";
import { colors, Flash, Icon, radius, spacing, Text } from "@/ui";

type RecipeLook = Pick<
  MacrosRecipeSummary,
  "name" | "iconKey" | "coverImageUrl"
>;

/**
 * The recipe's cover photo, or its food icon on a tinted tile of the same
 * shape, so a grid of recipes keeps one rhythm with or without photos.
 */
export function RecipeArt({
  recipe,
  aspectRatio,
  iconSize,
  style,
}: {
  recipe: RecipeLook;
  aspectRatio: number;
  iconSize: number;
  style?: StyleProp<ViewStyle>;
}) {
  if (recipe.coverImageUrl) {
    return (
      <RecipePhoto
        url={recipe.coverImageUrl}
        label={recipe.name}
        style={[styles.art, { aspectRatio }, style]}
      />
    );
  }
  return (
    <View style={[styles.art, styles.tile, { aspectRatio }, style]}>
      {recipe.iconKey ? (
        <FoodIcon name={recipe.name} iconKey={recipe.iconKey} size={iconSize} />
      ) : (
        <Icon
          name="chef-hat"
          size={iconSize * 0.6}
          weight="light"
          color={colors.secondaryLabel}
        />
      )}
    </View>
  );
}

export function pantryLabel(missing: number): string {
  return missing === 0 ? "Ready" : `${missing} missing`;
}

function PantryChip({ missing }: { missing: number }) {
  const ready = missing === 0;
  return (
    <View style={[styles.chip, ready && styles.chipReady]}>
      {ready ? (
        <Icon name="check" size={11} weight="bold" color={colors.onTint} />
      ) : null}
      <Text
        variant="caption1"
        weight="semibold"
        tone={ready ? "onTint" : "primary"}
      >
        {pantryLabel(missing)}
      </Text>
    </View>
  );
}

export function recipeMacroLine(
  recipe: Pick<MacrosRecipeSummary, "caloriesPerServing" | "proteinPerServing">,
  energyUnit: EnergyUnit,
): string {
  return `${formatEnergy(recipe.caloriesPerServing, energyUnit)} ${energyLabel(
    energyUnit,
  )} · ${formatGrams(recipe.proteinPerServing)} protein`;
}

/**
 * A photo-led recipe: art, name, energy and protein per serving, and how the
 * pantry covers it when the pantry is in use (`showPantry`).
 */
export function RecipeCard({
  recipe,
  width,
  feature = false,
  energyUnit,
  showPantry,
  flashToken,
  onPress,
  onLongPress,
}: {
  recipe: MacrosRecipeSummary;
  width: number;
  /** The larger card of the "Ready to cook" strip. */
  feature?: boolean;
  energyUnit: EnergyUnit;
  showPantry: boolean;
  flashToken?: number | null;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const coverage =
    showPantry && recipe.pantry && recipe.pantry.ingredients > 0
      ? recipe.pantry
      : null;
  const macros = recipeMacroLine(recipe, energyUnit);
  return (
    <Flash token={flashToken} style={[styles.flash, { width }]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={[
          recipe.name,
          `${macros} per serving`,
          coverage ? pantryLabel(coverage.missing) : null,
        ]
          .filter(Boolean)
          .join(", ")}
        accessibilityHint="Touch and hold for more"
        accessibilityActions={[{ name: "longpress", label: "More actions" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "longpress") onLongPress();
        }}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <View>
          <RecipeArt
            recipe={recipe}
            aspectRatio={feature ? 4 / 3 : 1}
            iconSize={feature ? 88 : 64}
          />
          {coverage ? <PantryChip missing={coverage.missing} /> : null}
        </View>
        <View style={styles.text}>
          <Text
            variant={feature ? "headline" : "subheadline"}
            weight="semibold"
            numberOfLines={2}
          >
            {recipe.name}
          </Text>
          <Text variant="footnote" tone="secondary" figure numberOfLines={1}>
            {macros}
          </Text>
        </View>
      </Pressable>
    </Flash>
  );
}

const styles = StyleSheet.create({
  art: {
    width: "100%",
    borderRadius: radius.md,
    overflow: "hidden",
  },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tertiaryFill,
  },
  chip: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  chipReady: {
    backgroundColor: colors.label,
  },
  flash: {
    borderRadius: radius.md,
  },
  card: {
    gap: spacing.sm,
  },
  text: {
    gap: spacing.xxs,
  },
  pressed: {
    opacity: 0.7,
  },
});
