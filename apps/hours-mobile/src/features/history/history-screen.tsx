import { formatMinutes } from "@repo/utils";
import { format } from "date-fns";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useOverview, useSessions } from "@/api/hours";
import { combine, daysAgo, localTime } from "@/lib/time";
import {
  Button,
  Hairline,
  HeaderButton,
  Notice,
  PageHeader,
  Row,
  Screen,
  Section,
  spacing,
  Text,
} from "@/ui";
import { groupHistory } from "./group";

const PAGE_WEEKS = 8;

export function HistoryScreen() {
  const [weeks, setWeeks] = useState(PAGE_WEEKS);
  const sessions = useSessions(daysAgo(weeks * 7));
  const overview = useOverview();
  const jobs = overview.data?.jobs ?? [];
  const jobName = new Map(jobs.map((job) => [job.id, job.name]));
  const grouped = useMemo(
    () => groupHistory(sessions.data ?? []),
    [sessions.data],
  );
  const total = grouped.reduce((sum, week) => sum + week.minutes, 0);

  return (
    <Screen
      onRefresh={() => void sessions.refetch()}
      refreshing={sessions.isRefetching}
    >
      <PageHeader title="History">
        <HeaderButton
          symbol="plus"
          label="Add shift"
          onPress={() => router.push("/shift")}
        />
      </PageHeader>
      <Text variant="footnote" tone="secondary" figure>
        {weeks} weeks · {formatMinutes(total)} h
      </Text>
      {sessions.error ? <Notice message={sessions.error.message} /> : null}
      {!sessions.data ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <View style={{ gap: spacing.xxl, marginTop: spacing.lg }}>
          {grouped.map((week) => (
            <View key={week.key} style={{ gap: spacing.lg }}>
              <View>
                <View style={styles.weekHeader}>
                  <Text variant="headline" style={{ flex: 1 }}>
                    {week.label}{" "}
                    <Text variant="footnote" tone="secondary" figure>
                      {week.range}
                    </Text>
                  </Text>
                  <Text variant="headline" figure>
                    {formatMinutes(week.minutes)}
                  </Text>
                </View>
                <Hairline />
              </View>
              {week.days.map(({ day, sessions: rows, minutes }) => (
                <Section
                  key={day}
                  title={format(combine(day, "12:00"), "EEE d MMM")}
                  trailing={
                    rows.length > 1 ? (
                      <Text variant="footnote" figure weight="semibold">
                        {formatMinutes(minutes)}
                      </Text>
                    ) : undefined
                  }
                >
                  {rows.map((row, index) => (
                    <Row
                      key={row.id}
                      title={`${localTime(new Date(row.start))} – ${row.end ? localTime(new Date(row.end)) : "now"}`}
                      subtitle={
                        [
                          jobs.length > 1 ? jobName.get(row.jobId) : undefined,
                          row.breakMinutes > 0
                            ? `break ${formatMinutes(row.breakMinutes)}`
                            : undefined,
                          row.note,
                        ]
                          .filter(Boolean)
                          .join(" · ") || undefined
                      }
                      value={formatMinutes(row.workedMinutes)}
                      valueTone={row.end ? "primary" : "working"}
                      chevron
                      separator={index < rows.length - 1}
                      onPress={() =>
                        router.push({
                          pathname: "/shift",
                          params: { id: row.id },
                        })
                      }
                    />
                  ))}
                </Section>
              ))}
            </View>
          ))}
          <Button
            label={`${PAGE_WEEKS} more weeks`}
            variant="plain"
            loading={sessions.isFetching}
            onPress={() => setWeeks((value) => value + PAGE_WEEKS)}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingTop: 80, alignItems: "center" },
  weekHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
});
