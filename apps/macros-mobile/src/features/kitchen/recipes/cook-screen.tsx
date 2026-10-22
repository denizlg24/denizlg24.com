import type {
  MacrosRecipeDetail,
  MacrosRecipeIngredientDetail,
} from "@repo/schemas/macros";
import { useKeepAwake } from "expo-keep-awake";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRecipe } from "@/api/recipes";
import { FoodIcon } from "@/components/food-icon";
import { parseNumberParam, readParam } from "@/features/add-food/target";
import { errorMessage } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  gutter,
  Hairline,
  HeaderIconButton,
  Icon,
  InlineNotice,
  radius,
  spacing,
  Text,
} from "@/ui";
import { scaledIngredientAmount, servingsLabel } from "../amounts";
import { RecipeBlocks } from "./recipe-blocks";
import { ingredientTitle } from "./recipe-card";

/**
 * Cooking, one page at a time: the ingredients for the chosen servings as a
 * checklist, then each step in large type. The screen stays awake while it
 * is open, and the last page logs what was made.
 */
export function CookScreen() {
  useKeepAwake();
  const params = useLocalSearchParams();
  const recipe = useRecipe(readParam(params.id));
  const insets = useSafeAreaInsets();

  if (!recipe.data) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.top}>
          <HeaderIconButton
            icon="x"
            label="Close"
            onPress={() => router.back()}
          />
        </View>
        <View style={styles.loading}>
          {recipe.isError ? (
            <InlineNotice
              message={`Couldn’t load this recipe. ${errorMessage(recipe.error)}`}
              action={{ label: "Retry", onPress: () => void recipe.refetch() }}
            />
          ) : (
            <ActivityIndicator />
          )}
        </View>
      </View>
    );
  }

  return (
    <CookPages
      key={recipe.data.id}
      recipe={recipe.data}
      servings={parseNumberParam(params.servings) ?? recipe.data.servings}
    />
  );
}

function CookPages({
  recipe,
  servings,
}: {
  recipe: MacrosRecipeDetail;
  servings: number;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());

  const steps = recipe.steps ?? [];
  const pageCount = 1 + steps.length;
  const last = page === pageCount - 1;
  const factor = recipe.servings > 0 ? servings / recipe.servings : 1;

  function goTo(index: number) {
    const next = Math.max(0, Math.min(pageCount - 1, index));
    haptics.selection();
    pager.current?.scrollTo({ x: next * width, animated: true });
    setPage(next);
  }

  function toggle(ingredient: MacrosRecipeIngredientDetail) {
    haptics.selection();
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(ingredient.id)) next.delete(ingredient.id);
      else next.add(ingredient.id);
      return next;
    });
  }

  function log() {
    router.push({
      pathname: "/recipe-log/[id]",
      // The batch was cooked for everyone; one portion is what was eaten.
      params: { id: recipe.id, name: recipe.name, servings: "1" },
    });
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.top}>
        <HeaderIconButton
          icon="x"
          label="Close"
          onPress={() => router.back()}
        />
        <Text
          variant="subheadline"
          weight="semibold"
          numberOfLines={1}
          style={styles.title}
        >
          {recipe.name}
        </Text>
        <Text variant="subheadline" tone="secondary" figure>
          {servingsLabel(servings)}
        </Text>
      </View>

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) =>
          setPage(Math.round(event.nativeEvent.contentOffset.x / width))
        }
      >
        <ScrollView style={{ width }} contentContainerStyle={styles.page}>
          <Text variant="footnote" tone="secondary" eyebrow>
            Before you start
          </Text>
          <Text variant="largeTitle">Ingredients</Text>
          <View>
            {recipe.ingredients.map((ingredient, index) => {
              const done = ticked.has(ingredient.id);
              const amount = scaledIngredientAmount(ingredient, factor);
              return (
                <View key={ingredient.id}>
                  <Pressable
                    onPress={() => toggle(ingredient)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: done }}
                    accessibilityLabel={`${ingredientTitle(ingredient)}, ${amount}`}
                    style={({ pressed }) => [
                      styles.ingredient,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Icon
                      name={done ? "circle-check" : "circle"}
                      size={26}
                      color={
                        done ? colors.tertiaryLabel : colors.secondaryLabel
                      }
                    />
                    <View style={done ? styles.dimmed : undefined}>
                      <FoodIcon
                        name={ingredient.foodName}
                        iconKey={ingredient.iconKey}
                        size={40}
                      />
                    </View>
                    <View style={styles.ingredientText}>
                      <Text
                        variant="title3"
                        weight="regular"
                        tone={done ? "tertiary" : "primary"}
                        style={done ? styles.struck : undefined}
                      >
                        {ingredientTitle(ingredient)}
                      </Text>
                      <Text variant="body" tone="secondary" figure>
                        {amount}
                      </Text>
                    </View>
                  </Pressable>
                  {index < recipe.ingredients.length - 1 ? <Hairline /> : null}
                </View>
              );
            })}
          </View>
        </ScrollView>

        {steps.map((step, index) => (
          <ScrollView
            key={`step-${index}`}
            style={{ width }}
            contentContainerStyle={styles.page}
          >
            <Text variant="footnote" tone="secondary" eyebrow>
              Step {index + 1} of {steps.length}
            </Text>
            <Text variant="largeTitle" accessibilityRole="header">
              {step.title || `Step ${index + 1}`}
            </Text>
            <RecipeBlocks
              blocks={step.blocks}
              fallbackLabel={step.title || `Step ${index + 1}`}
              large
            />
          </ScrollView>
        ))}
      </ScrollView>

      <View
        style={[
          styles.bottom,
          { paddingBottom: Math.max(insets.bottom, spacing.md) },
        ]}
      >
        <View
          style={styles.dots}
          accessible
          accessibilityLabel={`Page ${page + 1} of ${pageCount}`}
        >
          {Array.from({ length: pageCount }, (_, index) => (
            <View
              key={index}
              style={[styles.dot, index === page && styles.dotActive]}
            />
          ))}
        </View>
        <View style={styles.buttons}>
          {page > 0 ? (
            <Button
              label="Back"
              variant="tinted"
              block={false}
              style={styles.button}
              onPress={() => goTo(page - 1)}
            />
          ) : null}
          {last ? (
            <Button
              label="Log a serving"
              icon="plus"
              block={false}
              style={styles.button}
              onPress={log}
            />
          ) : (
            <Button
              label={page === 0 ? "Start cooking" : "Next step"}
              block={false}
              style={styles.button}
              onPress={() => goTo(page + 1)}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: gutter,
    paddingVertical: spacing.sm,
  },
  title: {
    flex: 1,
  },
  loading: {
    padding: gutter,
    paddingTop: spacing.xxxl,
  },
  page: {
    gap: spacing.lg,
    paddingHorizontal: gutter,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  ingredient: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  ingredientText: {
    flex: 1,
    gap: spacing.xxs,
  },
  pressed: {
    opacity: 0.6,
  },
  dimmed: {
    opacity: 0.4,
  },
  struck: {
    textDecorationLine: "line-through",
  },
  bottom: {
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingHorizontal: gutter,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiaryLabel,
  },
  dotActive: {
    width: 18,
    backgroundColor: colors.label,
  },
  buttons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  button: {
    flex: 1,
  },
});
