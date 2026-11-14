import { colors, HeaderButton, spacing, Text } from "@repo/native-ui";
import type { DashboardToday } from "@repo/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, View } from "react-native";
import { useToday, useUpcomingTasks } from "@/api/today";
import { StatusDot } from "@/features/shell/status";
import { TabPage } from "@/features/shell/tab-page";
import { WorkspaceShortcuts } from "@/features/workspace/workspace-shortcuts";
import { LiveClock } from "./live-clock";
import { TodayTabs } from "./today-tabs";

/** Daily overview with the same Home page and favorite pages as desktop. */
export function TodayScreen() {
  const client = useQueryClient();
  const router = useRouter();
  const today = useToday();
  const tasks = useUpcomingTasks();
  return (
    <TabPage
      title="Today"
      actions={
        <HeaderButton
          symbol="square.and.pencil"
          label="New workspace page"
          onPress={() => router.push("/workspace-new")}
        />
      }
      onRefresh={() => {
        void today.refetch();
        void tasks.refetch();
        void client.invalidateQueries({ queryKey: ["workspace"] });
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
        <WorkspaceShortcuts />
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
  stack: { flex: 1, gap: spacing.xl },
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
