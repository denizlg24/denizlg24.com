import { useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useBodyOverview } from "@/api/body";
import { useDistributionAccess } from "@/api/distribution";
import { useCustomFoods } from "@/api/foods";
import { useProfile } from "@/api/profile";
import { useRecipes } from "@/api/recipes";
import { useShoppingList } from "@/api/shopping-list";
import { formatInteger } from "@/lib/format";
import { Row, Screen, Section, spacing, Text, VStack } from "@/ui";
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
  const access = useDistributionAccess();

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
  const today = body.data?.today;
  const habitsDone =
    habits && today
      ? habits.filter((habit) => habit.completedDates.includes(today)).length
      : undefined;

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <VStack>
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

        {access.data?.owner ? (
          <Section title="Owner">
            <Row
              icon="inbox"
              title="Device requests"
              chevron
              separator={false}
              onPress={() => router.push("/more/device-requests")}
            />
          </Section>
        ) : null}

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
