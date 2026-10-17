import { colors, Hairline, spacing, Text } from "@repo/native-ui";
import type {
  DashboardToday,
  UpcomingCard,
  UpcomingKanbanResult,
} from "@repo/schemas";
import { useRouter } from "expo-router";
import { type ReactNode, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Segments } from "@/features/shell/segments";
import { Dash, QueryState } from "@/features/shell/tab-page";
import { ago, clock, dueLabel } from "@/lib/format";
import { useNow } from "@/lib/use-now";

type Tab = "events" | "tasks" | "alerts";
type Alert = DashboardToday["alerts"][number];

const SEVERITY_COLOR = {
  info: colors.tertiaryLabel,
  warning: colors.onBreak,
  critical: colors.destructive,
} as const;

interface FlatCard extends UpcomingCard {
  boardTitle: string;
  boardColor?: string;
}

/** Board grouping reads well on a board; here the question is what is due next. */
function flatten(upcoming: UpcomingKanbanResult): FlatCard[] {
  return upcoming.boards
    .flatMap((board) =>
      board.cards.map((card) => ({
        ...card,
        boardTitle: board.boardTitle,
        ...(board.boardColor ? { boardColor: board.boardColor } : {}),
      })),
    )
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

/**
 * A critical alert outranks the agenda for the pane that opens: the schedule
 * is a reminder, an exceeded budget is a decision.
 */
function openingTab(
  today: DashboardToday | undefined,
  tasks: UpcomingKanbanResult | undefined,
): Tab {
  if (today?.alerts.some((alert) => alert.severity === "critical")) {
    return "alerts";
  }
  if (today && today.agenda.length > 0) return "events";
  if (tasks && tasks.stats.total > 0) return "tasks";
  if (today && today.counts.budgetAlerts > 0) return "alerts";
  return "events";
}

/** The desktop's Schedule / Tasks / Alerts switcher, one pane at a time. */
export function TodayTabs({
  today,
  todayError,
  tasks,
  tasksError,
}: {
  today: DashboardToday | undefined;
  todayError: Error | null;
  tasks: UpcomingKanbanResult | undefined;
  tasksError: Error | null;
}) {
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = picked ?? openingTab(today, tasks);
  const critical =
    today?.alerts.filter((alert) => alert.severity === "critical").length ?? 0;

  return (
    <View>
      <Segments
        centered
        value={tab}
        onChange={setPicked}
        options={[
          { value: "events", label: "Events", count: today?.agenda.length },
          {
            value: "tasks",
            label: "Tasks",
            count: tasks?.stats.total,
            alert: (tasks?.stats.overdue ?? 0) > 0,
          },
          {
            value: "alerts",
            label: "Alerts",
            count: today?.counts.budgetAlerts,
            alert: critical > 0,
          },
        ]}
      />
      {tab === "tasks" ? (
        <>
          <QueryState error={tasksError} loading={!tasks} />
          {tasks ? <Tasks upcoming={tasks} /> : null}
        </>
      ) : (
        <>
          <QueryState error={todayError} loading={!today} />
          {today && tab === "events" ? <Events today={today} /> : null}
          {today && tab === "alerts" ? <Alerts today={today} /> : null}
        </>
      )}
    </View>
  );
}

function Summary({ parts }: { parts: { label: string; alert?: boolean }[] }) {
  return (
    <View style={styles.summary}>
      {parts.map((part) => (
        <Text
          key={part.label}
          variant="caption2"
          eyebrow
          tone={part.alert ? "destructive" : "tertiary"}
        >
          {part.label}
        </Text>
      ))}
    </View>
  );
}

function Events({ today }: { today: DashboardToday }) {
  const router = useRouter();
  const now = useNow(true, 60_000);
  if (today.agenda.length === 0) return <Dash />;
  return (
    <View>
      {today.agenda.map((item, index) => {
        const over =
          !item.allDay &&
          new Date(item.end ?? item.start).getTime() < now.getTime();
        const open =
          item.kind === "event"
            ? () => router.push(`/event?id=${item.id}`)
            : item.courseId
              ? () => router.push(`/calendar/course/${item.courseId}`)
              : undefined;
        return (
          <Line
            key={item.id}
            onPress={open}
            separator={index < today.agenda.length - 1}
          >
            <Text
              variant="footnote"
              tone="secondary"
              figure
              style={styles.time}
            >
              {item.allDay ? "all day" : clock(item.start)}
            </Text>
            <View
              style={[
                styles.bar,
                {
                  backgroundColor:
                    item.kind === "class" ? colors.accent : colors.label,
                },
              ]}
            />
            <View style={styles.body}>
              <Text tone={over ? "tertiary" : "primary"} numberOfLines={1}>
                {item.title}
              </Text>
              {item.place || item.end ? (
                <Text variant="caption1" tone="tertiary" numberOfLines={1}>
                  {[
                    item.end && !item.allDay
                      ? `until ${clock(item.end)}`
                      : null,
                    item.place,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              ) : null}
            </View>
          </Line>
        );
      })}
    </View>
  );
}

function Tasks({ upcoming }: { upcoming: UpcomingKanbanResult }) {
  const cards = useMemo(() => flatten(upcoming), [upcoming]);
  if (cards.length === 0) return <Dash />;
  const { overdue, dueToday, dueThisWeek } = upcoming.stats;
  return (
    <View>
      <Summary
        parts={[
          ...(overdue > 0
            ? [{ label: `${overdue} overdue`, alert: true }]
            : []),
          ...(dueToday > 0 ? [{ label: `${dueToday} today` }] : []),
          { label: `${dueThisWeek} this week` },
        ]}
      />
      {cards.map((card, index) => (
        <Line key={card._id} separator={index < cards.length - 1}>
          <Text
            variant="footnote"
            tone={card.overdue ? "destructive" : "secondary"}
            figure
            style={styles.due}
          >
            {dueLabel(card.daysUntilDue, card.overdue)}
          </Text>
          <View style={styles.body}>
            <Text numberOfLines={2}>{card.title}</Text>
            <View style={styles.board}>
              <View
                style={[
                  styles.boardDot,
                  { backgroundColor: card.boardColor ?? colors.tertiaryLabel },
                ]}
              />
              <Text variant="caption1" tone="tertiary" numberOfLines={1}>
                {card.boardTitle} · {card.columnTitle}
              </Text>
            </View>
          </View>
        </Line>
      ))}
    </View>
  );
}

function Alerts({ today }: { today: DashboardToday }) {
  const router = useRouter();
  const alerts = today.alerts;
  if (alerts.length === 0) return <Dash />;
  const critical = alerts.filter(
    (alert) => alert.severity === "critical",
  ).length;
  const more = today.counts.budgetAlerts - alerts.length;
  const open = (alert?: Alert) =>
    router.navigate(
      alert?.envelopeId
        ? `/money/envelope/${alert.envelopeId}`
        : "/money?view=budget",
    );
  return (
    <View>
      <Summary
        parts={[
          ...(critical > 0
            ? [{ label: `${critical} critical`, alert: true }]
            : []),
          { label: `${today.counts.budgetAlerts} open` },
        ]}
      />
      {alerts.map((alert, index) => (
        <Line
          key={alert.id}
          onPress={() => open(alert)}
          separator={index < alerts.length - 1 || more > 0}
        >
          <View
            style={[
              styles.severity,
              { backgroundColor: SEVERITY_COLOR[alert.severity] },
            ]}
          />
          <View style={styles.body}>
            <Text numberOfLines={1}>{alert.title}</Text>
            {alert.detail ? (
              <Text variant="caption1" tone="tertiary" numberOfLines={2}>
                {alert.detail}
              </Text>
            ) : null}
          </View>
          {alert.firstSeenAt ? (
            <Text variant="caption1" tone="tertiary" figure>
              {ago(alert.firstSeenAt)}
            </Text>
          ) : null}
        </Line>
      ))}
      {more > 0 ? (
        <Line onPress={() => open()} separator={false}>
          <Text variant="footnote" tone="secondary">
            {more} more
          </Text>
        </Line>
      ) : null}
    </View>
  );
}

function Line({
  children,
  onPress,
  separator,
}: {
  children: ReactNode;
  onPress?: () => void;
  separator: boolean;
}) {
  const row = <View style={styles.line}>{children}</View>;
  return (
    <View>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={({ pressed }) => pressed && { opacity: 0.55 }}
        >
          {row}
        </Pressable>
      ) : (
        row
      )}
      {separator ? <Hairline /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.md,
    paddingBottom: spacing.xs,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.sm,
  },
  time: { width: 50 },
  due: { width: 72 },
  bar: { width: 2, alignSelf: "stretch", borderRadius: 1 },
  body: { flex: 1, gap: spacing.xxs },
  board: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  boardDot: { width: 6, height: 6, borderRadius: 3 },
  severity: { width: 7, height: 7, borderRadius: 4 },
});
