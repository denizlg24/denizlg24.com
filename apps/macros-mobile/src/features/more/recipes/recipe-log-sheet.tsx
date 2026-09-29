import { onlineManager } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { type LogRecipeInput, useLogRecipe } from "@/api/food-log";
import { useProfile } from "@/api/profile";
import { useRecipe, useRecipes } from "@/api/recipes";
import { EatenAtPicker } from "@/components/eaten-at-picker";
import { MacroInline } from "@/components/macro-bars";
import { deviceTimeZone, useToday } from "@/lib/day";
import { energyLabel, formatDecimal, formatEnergy } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { type LogTime, logPlacement } from "@/lib/log-time";
import { Button, EmptyState, gutter, spacing, Text } from "@/ui";
import { Stepper } from "@/ui/stepper";
import { NoticeSlot, useNotice } from "../shared/notice";

function servingsLabel(servings: number) {
  return `${formatDecimal(servings)} ${servings === 1 ? "serving" : "servings"}`;
}

export function RecipeLogSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const profile = useProfile();
  const timeZone = profile.data?.timezone ?? deviceTimeZone();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const today = useToday(timeZone);
  const listed = useRecipes().data?.find((recipe) => recipe.id === id);
  const detail = useRecipe(listed ? undefined : id);
  const recipe = listed ?? detail.data;
  const logRecipe = useLogRecipe();
  const { notice, showError, clear } = useNotice();

  const [servings, setServings] = useState(1);
  const [picked, setPicked] = useState<LogTime | null>(null);
  const when = picked ?? { date: today, clock: null };

  if (!recipe) {
    return (
      <View style={styles.sheet}>
        {detail.isError ? (
          <EmptyState icon="triangle-alert" title="Couldn’t load this recipe" />
        ) : null}
      </View>
    );
  }

  const recipeId = recipe.id;

  function submit() {
    clear();
    const input: LogRecipeInput = {
      recipeId,
      servingsConsumed: servings,
      ...logPlacement(when, timeZone),
    };
    if (!onlineManager.isOnline()) {
      // Queued and persisted; it is sent when the phone is back online.
      logRecipe.mutate(input);
      haptics.success();
      router.back();
      return;
    }
    logRecipe.mutate(input, {
      onSuccess: () => {
        haptics.success();
        router.back();
      },
      onError: showError,
    });
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Text variant="headline" numberOfLines={2}>
          {recipe.name}
        </Text>
        <Text variant="footnote" tone="secondary" figure>
          {formatEnergy(recipe.caloriesPerServing, energyUnit)}{" "}
          {energyLabel(energyUnit)} per {recipe.servingLabel || "serving"}
        </Text>
      </View>

      <Stepper
        label={servingsLabel(servings)}
        value={servings}
        step={0.5}
        min={0.5}
        max={50}
        onValueChange={(value) => {
          haptics.selection();
          setServings(value);
        }}
        style={styles.control}
      />

      <View
        style={styles.totals}
        accessible
        accessibilityLabel="Total for this entry"
      >
        <Text variant="title2" figure>
          {formatEnergy(recipe.caloriesPerServing * servings, energyUnit)}
          <Text variant="footnote" tone="secondary">
            {" "}
            {energyLabel(energyUnit)}
          </Text>
        </Text>
        <MacroInline
          protein={recipe.proteinPerServing * servings}
          carbs={recipe.carbsPerServing * servings}
          fat={recipe.fatPerServing * servings}
        />
      </View>

      <EatenAtPicker
        value={when}
        timeZone={timeZone}
        today={today}
        onChange={setPicked}
      />

      <NoticeSlot notice={notice} onDismiss={clear} />

      <Button
        label={`Log ${servingsLabel(servings)}`}
        loading={logRecipe.isPending && onlineManager.isOnline()}
        onPress={submit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: gutter,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xxs,
  },
  control: {
    alignSelf: "stretch",
  },
  totals: {
    gap: spacing.xs,
  },
});
