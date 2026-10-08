import type { WorkHoursOverview, WorkPayPeriod } from "@repo/schemas";
import { formatMinutes, formatMoney } from "@repo/utils";
import { format } from "date-fns";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useClock, useOverview } from "@/api/hours";
import { haptics } from "@/lib/haptics";
import { clockface, localTime } from "@/lib/time";
import {
  Button,
  colors,
  Hairline,
  HeaderButton,
  Notice,
  PageHeader,
  Screen,
  Section,
  Stat,
  spacing,
  Text,
} from "@/ui";
import { JobForm } from "../jobs/job-form";
import { useNow } from "./use-now";

type ClockAction = "in" | "out" | "break" | "resume";

const ACTION_LABEL: Record<ClockAction, string> = {
  in: "Check in",
  out: "Check out",
  break: "Break",
  resume: "Resume",
};

export function ClockScreen() {
  const overview = useOverview();
  return (
    <Screen
      onRefresh={() => void overview.refetch()}
      refreshing={overview.isRefetching}
    >
      <PageHeader title="Hours">
        <HeaderButton
          symbol="briefcase"
          label="Jobs"
          onPress={() => router.push("/jobs")}
        />
        <HeaderButton
          symbol="bell"
          label="Reminders"
          onPress={() => router.push("/settings")}
        />
      </PageHeader>
      {overview.data ? (
        <Clock overview={overview.data} />
      ) : overview.error ? (
        <Notice message={overview.error.message} />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      )}
    </Screen>
  );
}

function Clock({ overview }: { overview: WorkHoursOverview }) {
  const clock = useClock();
  const active = overview.active;
  const activeJobs = overview.jobs.filter((job) => job.status === "active");
  const job = active
    ? overview.jobs.find((row) => row.id === active.jobId)
    : undefined;
  const openBreak = active?.breaks.find((item) => !item.end);
  const now = useNow(Boolean(active));
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const selectedJob =
    activeJobs.find((row) => row.id === jobId) ?? activeJobs[0];

  // Worked time to the second, derived as the server does, so the figure
  // never jumps when the overview reloads.
  const runningMs = useMemo(() => {
    if (!active) return 0;
    const start = new Date(active.start).getTime();
    let breakMs = 0;
    for (const item of active.breaks) {
      const breakStart = new Date(item.start).getTime();
      const breakEnd = item.end ? new Date(item.end).getTime() : now.getTime();
      breakMs += Math.max(0, breakEnd - breakStart);
    }
    const total = now.getTime() - start;
    return job?.breaksPaid ? total : total - breakMs;
  }, [active, now, job?.breaksPaid]);

  const liveMinutes = (minutes: number) =>
    active
      ? minutes - active.workedMinutes + Math.floor(runningMs / 60_000)
      : minutes;
  const today = liveMinutes(overview.today.workedMinutes);

  function act(action: ClockAction) {
    if (clock.isPending) return;
    haptics.impact();
    clock.mutate(
      {
        action,
        jobId: action === "in" ? selectedJob?.id : undefined,
      },
      {
        onSuccess: () => haptics.success(),
        onError: () => haptics.error(),
      },
    );
  }

  if (activeJobs.length === 0 && !active) {
    return (
      <Section title="Job">
        <JobForm job={null} />
      </Section>
    );
  }

  const primary: "in" | "out" = active ? "out" : "in";
  const status = !active
    ? "Off"
    : openBreak
      ? `Break · ${localTime(new Date(openBreak.start))}`
      : `In · ${localTime(new Date(active.start))}`;

  return (
    <View style={{ gap: spacing.xxl }}>
      <View style={styles.center}>
        <View style={styles.status}>
          <View
            style={[
              styles.dot,
              {
                backgroundColor: !active
                  ? colors.tertiaryLabel
                  : openBreak
                    ? colors.onBreak
                    : colors.working,
              },
            ]}
          />
          <Text variant="caption1" tone="secondary" eyebrow numberOfLines={1}>
            {status}
            {job && activeJobs.length > 1 ? ` · ${job.name}` : ""}
          </Text>
        </View>

        <View style={{ alignItems: "center" }}>
          <Text
            figure
            weight="semibold"
            tone={openBreak ? "secondary" : "primary"}
            style={styles.figure}
            accessibilityRole="timer"
          >
            {active ? clockface(runningMs) : formatMinutes(today)}
          </Text>
          <Text variant="footnote" tone="secondary" figure>
            {active ? `today ${formatMinutes(today)}` : "today"}
          </Text>
        </View>

        {!active && activeJobs.length > 1 && selectedJob ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              ActionSheetIOS.showActionSheetWithOptions(
                {
                  options: [...activeJobs.map((row) => row.name), "Cancel"],
                  cancelButtonIndex: activeJobs.length,
                },
                (index) => {
                  const picked = activeJobs[index];
                  if (picked) {
                    haptics.selection();
                    setJobId(picked.id);
                  }
                },
              )
            }
            style={styles.jobPicker}
          >
            <Text variant="subheadline" weight="medium">
              {selectedJob.name}
            </Text>
            <SymbolView
              name="chevron.up.chevron.down"
              size={12}
              tintColor={colors.secondaryLabel}
            />
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ACTION_LABEL[primary]}
          disabled={clock.isPending}
          onPress={() => act(primary)}
          style={({ pressed }) => [
            styles.primary,
            primary === "in" ? styles.primaryIn : styles.primaryOut,
            pressed && { transform: [{ scale: 0.95 }] },
            clock.isPending && { opacity: 0.6 },
          ]}
        >
          {clock.isPending && clock.variables?.action === primary ? (
            <ActivityIndicator
              color={primary === "in" ? colors.onTint : colors.label}
            />
          ) : (
            <Text
              variant="title2"
              weight="semibold"
              tone={primary === "in" ? "onTint" : "primary"}
            >
              {ACTION_LABEL[primary]}
            </Text>
          )}
        </Pressable>

        <View style={styles.secondary}>
          {active ? (
            <Button
              label={openBreak ? "Resume" : "Break"}
              symbol={openBreak ? "arrow.uturn.forward" : "cup.and.saucer"}
              variant="tinted"
              size="regular"
              block={false}
              style={{ flex: 1 }}
              loading={
                clock.isPending &&
                (clock.variables?.action === "break" ||
                  clock.variables?.action === "resume")
              }
              onPress={() => act(openBreak ? "resume" : "break")}
            />
          ) : null}
          <Button
            label="Earlier"
            symbol="clock.arrow.circlepath"
            variant="plain"
            size="regular"
            block={false}
            style={{ flex: 1 }}
            onPress={() => router.push("/earlier")}
          />
        </View>
        {clock.error ? <Notice message={clock.error.message} /> : null}
      </View>

      <View>
        <Hairline />
        <View style={styles.stats}>
          <Stat label="Today" value={formatMinutes(today)} />
          <Stat
            label="Week"
            value={formatMinutes(liveMinutes(overview.week.workedMinutes))}
          />
          <Stat
            label="Month"
            value={formatMinutes(liveMinutes(overview.month.workedMinutes))}
          />
        </View>
        <Hairline />
      </View>

      {overview.payPeriods.map((period) => (
        <PayPeriodSummary key={period.ruleId} period={period} />
      ))}
    </View>
  );
}

export function PayPeriodSummary({ period }: { period: WorkPayPeriod }) {
  const short = (day: string) => format(new Date(`${day}T12:00:00`), "d MMM");
  return (
    <Section title={period.ruleName}>
      <View style={styles.payRow}>
        <View style={{ flex: 1 }}>
          <Text variant="title2" figure tone="working" numberOfLines={1}>
            {formatMoney(period.netMinor, period.currency)}
          </Text>
          <Text variant="caption1" tone="secondary" figure numberOfLines={1}>
            gross {formatMoney(period.grossMinor, period.currency)} · pays{" "}
            {short(period.payoutDate)}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text variant="caption1" tone="secondary" figure>
            {short(period.periodStart)} – {short(period.periodEnd)}
            {period.partial ? " · partial" : ""}
          </Text>
          <Text variant="caption1" tone="secondary" figure>
            {formatMinutes(period.loggedMinutes)}
            {period.projectedMinutes !== period.loggedMinutes
              ? ` → ${formatMinutes(period.projectedMinutes)}`
              : ""}{" "}
            h
          </Text>
        </View>
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  loading: { paddingTop: 120, alignItems: "center" },
  center: { alignItems: "center", gap: spacing.xl, paddingTop: spacing.sm },
  status: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
  figure: { fontSize: 60, lineHeight: 68, letterSpacing: -1 },
  jobPicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.tertiaryFill,
  },
  primary: {
    width: 168,
    height: 168,
    borderRadius: 84,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryIn: { backgroundColor: colors.tint },
  primaryOut: { borderWidth: 2, borderColor: colors.label },
  secondary: {
    flexDirection: "row",
    gap: spacing.sm,
    alignSelf: "stretch",
    paddingHorizontal: spacing.xxl,
  },
  stats: { flexDirection: "row", paddingVertical: spacing.lg },
  payRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.lg,
    paddingTop: spacing.sm,
  },
});
