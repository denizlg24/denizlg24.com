import { useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useBodyOverview } from "@/api/body";
import { useProfile } from "@/api/profile";
import { deviceTimeZone, useToday } from "@/lib/day";
import { Row, Screen, Section, spacing, Text, VStack } from "@/ui";
import { useRefresh } from "./shared/use-refresh";

/** Body, Habits and Settings, opened from the person button on Today. */
export function MoreScreen() {
  const router = useRouter();
  const profile = useProfile();
  const body = useBodyOverview();

  const refetch = useCallback(
    () => Promise.all([profile.refetch(), body.refetch()]),
    [profile, body],
  );
  const { refreshing, onRefresh } = useRefresh(refetch);

  const habits = body.data?.habits;
  const today = useToday(profile.data?.timezone ?? deviceTimeZone());
  const habitsDone = habits
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

        <Section>
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
