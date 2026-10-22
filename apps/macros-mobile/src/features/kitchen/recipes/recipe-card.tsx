import type {
  MacrosRecipeIngredientDetail,
  MacrosRecipeSummary,
} from "@repo/schemas/macros";
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
  formatDecimal,
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

/** What the recipe calls an ingredient, else the food's own name. */
export function ingredientTitle(
  ingredient: Pick<MacrosRecipeIngredientDetail, "displayName" | "foodName">,
): string {
  return ingredient.displayName || ingredient.foodName;
}

/** Cooked servings waiting in the pantry: "2 stored". */
export function storedLabel(servings: number): string {
  return `${formatDecimal(servings)} stored`;
}

function PantryChip({ label, ready }: { label: string; ready: boolean }) {
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
        {label}
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
  const stored = recipe.storedServings ?? 0;
  const chip =
    stored > 0
      ? { label: storedLabel(stored), ready: true }
      : coverage
        ? {
            label: pantryLabel(coverage.missing),
            ready: coverage.missing === 0,
          }
        : null;
  const macros = recipeMacroLine(recipe, energyUnit);
  return (
    <Flash token={flashToken} style={[styles.flash, { width }]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={[recipe.name, `${macros} per serving`, chip?.label]
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
          {chip ? <PantryChip label={chip.label} ready={chip.ready} /> : null}
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
