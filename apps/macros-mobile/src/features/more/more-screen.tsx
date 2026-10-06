import { useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useBodyOverview } from "@/api/body";
import { useCustomFoods } from "@/api/foods";
import { useProfile } from "@/api/profile";
import { useRecipes } from "@/api/recipes";
import { useShoppingList } from "@/api/shopping-list";
import { deviceTimeZone, useToday } from "@/lib/day";
import { formatInteger } from "@/lib/format";
import { PageHeader, Row, Screen, Section, spacing, Text, VStack } from "@/ui";
import { useRefresh } from "./shared/use-refresh";

function count(value: number | undefined) {
  return value === undefined ? undefined : formatInteger(value);
}

export function MoreScreen() {
  const router = useRouter();
  const profile = useProfile();
  const foods = useCustomFoods();
  const recipes = useRecipes();
  const shopping = useShoppingList();
  const body = useBodyOverview();

  const refetch = useCallback(
    () =>
      Promise.all([
        profile.refetch(),
        foods.refetch(),
        recipes.refetch(),
        shopping.refetch(),
        body.refetch(),
      ]),
    [profile, foods, recipes, shopping, body],
  );
  const { refreshing, onRefresh } = useRefresh(refetch);

  const toGet = shopping.data?.filter((item) => !item.checked).length;
  const habits = body.data?.habits;
  const today = useToday(profile.data?.timezone ?? deviceTimeZone());
  const habitsDone = habits
    ? habits.filter((habit) => habit.completedDates.includes(today)).length
    : undefined;

  return (
    <Screen statusBarScrim onRefresh={onRefresh} refreshing={refreshing}>
      <VStack>
        <PageHeader title="More" />
        {profile.data ? (
          <View style={styles.account} accessible accessibilityRole="header">
            <Text variant="title2" numberOfLines={2}>
              {profile.data.name}
            </Text>
            <Text variant="subheadline" tone="secondary" numberOfLines={1}>
              {profile.data.email}
            </Text>
          </View>
        ) : null}

        <Section title="Food">
          <Row
            icon="utensils"
            title="My foods"
            value={count(foods.data?.length)}
            chevron
            onPress={() => router.push("/more/foods")}
          />
          <Row
            icon="chef-hat"
            title="Recipes"
            value={count(recipes.data?.length)}
            chevron
            onPress={() => router.push("/more/recipes")}
          />
          <Row
            icon="shopping-cart"
            title="Shopping list"
            value={toGet ? `${formatInteger(toGet)} to get` : undefined}
            chevron
            separator={false}
            onPress={() => router.push("/more/shopping-list")}
          />
        </Section>

        <Section title="You">
          <Row
            icon="person-standing"
            title="Body"
            chevron
            onPress={() => router.push("/more/body")}
          />
          <Row
            icon="list-checks"
            title="Habits"
            value={
              habits && habits.length > 0 && habitsDone !== undefined
                ? `${habitsDone} of ${habits.length} today`
                : undefined
            }
            chevron
            separator={false}
            onPress={() => router.push("/more/habits")}
          />
        </Section>

        <Section>
          <Row
            icon="settings"
            title="Settings"
            chevron
            separator={false}
            onPress={() => router.push("/more/settings")}
          />
        </Section>
      </VStack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  account: {
    gap: spacing.xxs,
  },
});
