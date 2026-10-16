import { colors, Row, Section, Stack, spacing, Text } from "@repo/native-ui";
import type { DashboardToday } from "@repo/schemas";
import { formatMoney } from "@repo/utils";
import { type Href, useRouter } from "expo-router";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useBoard, useToday } from "@/api/today";
import { Dash, QueryState, TabPage } from "@/features/shell/tab-page";
import { clock, dayLabel, until } from "@/lib/format";
import { BoardSection } from "./board-section";
import { StatusDot, severityTone } from "./status";

export function TodayScreen() {
  const today = useToday();
  const board = useBoard();
  const data = today.data;
  return (
    <TabPage
      title="Today"
      onRefresh={() => {
        void today.refetch();
        void board.refetch();
      }}
      refreshing={today.isRefetching}
    >
      <QueryState error={today.error} loading={!data} />
      {data ? <Overview today={data} /> : null}
      <BoardSection />
      {data ? <Footer today={data} /> : null}
    </TabPage>
  );
}

function Overview({ today }: { today: DashboardToday }) {
  const router = useRouter();
  return (
    <Stack>
      {today.now || today.shift ? (
        <View style={styles.lead}>
          {today.now ? (
            <Text variant="subheadline" tone="secondary" numberOfLines={2}>
              {today.now}
            </Text>
          ) : null}
          {today.shift ? (
            <Pressable onPress={() => void Linking.openURL("hours://")}>
              <Text
                variant="subheadline"
                tone={today.shift.onBreak ? "onBreak" : "working"}
              >
                {today.shift.onBreak ? "On break" : "On shift"} ·{" "}
                {today.shift.jobName} · since {clock(today.shift.start)}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.counts}>
        <Count
          label="Triage"
          value={today.counts.triage}
          href="/inbox?view=triage"
        />
        <Count label="Unread" value={today.counts.unreadMail} href="/inbox" />
        <Count
          label="Contacts"
          value={today.counts.newContacts}
          href="/inbox?view=contacts"
        />
        <Count
          label="Alerts"
          value={today.counts.budgetAlerts}
          href="/money?view=budget"
        />
      </View>

      <Section title="Agenda">
        {today.agenda.length === 0 ? (
          <Dash />
        ) : (
          today.agenda.map((item, index) => (
            <Row
              key={item.id}
              title={item.title}
              subtitle={item.place}
              value={
                item.allDay
                  ? "All day"
                  : `${clock(item.start)}${item.end ? `–${clock(item.end)}` : ""}`
              }
              separator={index < today.agenda.length - 1}
              onPress={
                item.kind === "event"
                  ? () => router.push(`/event?id=${item.id}`)
                  : undefined
              }
            />
          ))
        )}
      </Section>

      {today.nextDeadline ? (
        <Section title="Next deadline">
          <Row
            title={today.nextDeadline.title}
            subtitle={today.nextDeadline.courseName}
            value={`${dayLabel(today.nextDeadline.dueAt)} ${clock(today.nextDeadline.dueAt)}`}
            valueTone={today.nextDeadline.overdue ? "primary" : "secondary"}
            destructive={today.nextDeadline.overdue}
            separator={false}
            chevron
            onPress={() =>
              router.push(`/calendar/course/${today.nextDeadline?.courseId}`)
            }
          />
        </Section>
      ) : null}

      {today.budget || today.alerts.length > 0 ? (
        <Section title="Budget">
          {today.budget ? (
            <Row
              title="Left this month"
              value={formatMoney(
                today.budget.availableMinor,
                today.budget.currency,
              )}
              valueTone="primary"
              subtitle={`${formatMoney(today.budget.spentMinor, today.budget.currency)} of ${formatMoney(today.budget.plannedMinor, today.budget.currency)}`}
              separator={today.alerts.length > 0}
              onPress={() => router.navigate("/money?view=budget")}
            />
          ) : null}
          {today.alerts.map((alert, index) => (
            <Row
              key={alert.id}
              title={alert.title}
              trailing={
                <Text variant="footnote" tone={severityTone(alert.severity)}>
                  {alert.severity}
                </Text>
              }
              separator={index < today.alerts.length - 1}
              onPress={() =>
                router.push(
                  alert.envelopeId
                    ? `/money/envelope/${alert.envelopeId}`
                    : "/money?view=budget",
                )
              }
            />
          ))}
        </Section>
      ) : null}
    </Stack>
  );
}

function Count({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: Href;
}) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.navigate(href)}
      style={({ pressed }) => [styles.count, pressed && { opacity: 0.55 }]}
    >
      <Text variant="caption2" tone="secondary" eyebrow>
        {label}
      </Text>
      <Text
        variant="title3"
        figure
        weight="semibold"
        tone={value === 0 ? "tertiary" : "primary"}
      >
        {value}
      </Text>
    </Pressable>
  );
}

function Footer({ today }: { today: DashboardToday }) {
  const router = useRouter();
  return (
    <Stack>
      {today.resources.length > 0 ? (
        <Section title="Resources">
          <Pressable
            onPress={() => router.push("/more/resources")}
            style={styles.resources}
          >
            {today.resources.map((resource) => (
              <View key={resource.id} style={styles.resource}>
                <StatusDot status={resource.status} />
                <Text variant="footnote" tone="secondary" numberOfLines={1}>
                  {resource.name}
                </Text>
              </View>
            ))}
          </Pressable>
        </Section>
      ) : null}
      <Text variant="caption1" tone="tertiary" figure>
        LLM ${today.llm.todayUsd.toFixed(2)} today · $
        {today.llm.monthUsd.toFixed(2)} this month · updated{" "}
        {until(today.generatedAt)}
      </Text>
    </Stack>
  );
}

const styles = StyleSheet.create({
  lead: { gap: spacing.xs },
  counts: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingVertical: spacing.md,
  },
  count: { flex: 1, gap: spacing.xxs },
  resources: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  resource: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    maxWidth: "45%",
  },
});
