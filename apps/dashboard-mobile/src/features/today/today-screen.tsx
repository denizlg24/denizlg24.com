import { colors, spacing, Text } from "@repo/native-ui";
import type { DashboardToday } from "@repo/schemas";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, View } from "react-native";
import { useToday, useUpcomingTasks } from "@/api/today";
import { StatusDot } from "@/features/shell/status";
import { TabPage } from "@/features/shell/tab-page";
import { LiveClock } from "./live-clock";
import { TodayTabs } from "./today-tabs";

/** The desktop's dashboard home: the time, then Events / Tasks / Alerts, then the machines. */
export function TodayScreen() {
  const today = useToday();
  const tasks = useUpcomingTasks();
  return (
    <TabPage
      title="Today"
      onRefresh={() => {
        void today.refetch();
        void tasks.refetch();
      }}
      refreshing={today.isRefetching}
      contentContainerStyle={styles.page}
    >
      <View style={styles.stack}>
        <LiveClock />
        <TodayTabs
          today={today.data}
          todayError={today.error}
          tasks={tasks.data}
          tasksError={tasks.error}
        />
        {today.data ? <Footer today={today.data} /> : null}
      </View>
    </TabPage>
  );
}

function Footer({ today }: { today: DashboardToday }) {
  const router = useRouter();
  return (
    <View style={styles.footer}>
      {today.resources.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resources"
          onPress={() => router.push("/more/resources")}
          style={styles.resources}
        >
          {today.resources.map((resource) => (
            <View key={resource.id} style={styles.resource}>
              <StatusDot status={resource.status} />
              <Text variant="caption1" tone="secondary" numberOfLines={1}>
                {resource.name}
              </Text>
            </View>
          ))}
        </Pressable>
      ) : null}
      <View style={styles.llm}>
        <SymbolView name="brain" size={12} tintColor={colors.tertiaryLabel} />
        <Text variant="caption1" tone="secondary" figure>
          ${today.llm.todayUsd.toFixed(2)} today · $
          {today.llm.monthUsd.toFixed(2)} this month
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  stack: { flex: 1, justifyContent: "center", gap: spacing.xl },
  footer: { alignItems: "center", gap: spacing.md, paddingTop: spacing.sm },
  resources: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    columnGap: spacing.lg,
    rowGap: spacing.sm,
  },
  resource: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  llm: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
});
