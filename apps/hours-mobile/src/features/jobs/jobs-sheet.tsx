import { formatMoney } from "@repo/utils";
import { useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { useOverview, useSaveJob } from "@/api/hours";
import { haptics } from "@/lib/haptics";
import { Button, colors, Hairline, Row, Section, spacing } from "@/ui";
import { JobForm } from "./job-form";

export function JobsSheet() {
  const overview = useOverview();
  const save = useSaveJob();
  const jobs = overview.data?.jobs ?? [];
  const [editing, setEditing] = useState<string | "new" | null>(
    jobs.length === 1 ? (jobs[0]?.id ?? null) : null,
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View>
        {jobs.map((job) => {
          const expanded = editing === job.id;
          return (
            <View key={job.id}>
              <View style={styles.jobRow}>
                <View style={{ flex: 1 }}>
                  <Row
                    title={job.name}
                    subtitle={[
                      `${formatMoney(job.hourlyRateMinor, job.currency)}/h`,
                      job.expectedWeeklyHours !== undefined
                        ? `${job.expectedWeeklyHours} h/wk`
                        : undefined,
                      job.status === "archived" ? "archived" : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    chevron
                    separator={false}
                    onPress={() => setEditing(expanded ? null : job.id)}
                  />
                </View>
                <Switch
                  accessibilityLabel={`${job.name} active`}
                  value={job.status === "active"}
                  trackColor={{ true: colors.working }}
                  onValueChange={(on) => {
                    haptics.selection();
                    save.mutate({
                      id: job.id,
                      patch: { status: on ? "active" : "archived" },
                    });
                  }}
                />
              </View>
              {expanded ? (
                <View style={styles.form}>
                  <JobForm job={job} onSaved={() => setEditing(null)} />
                </View>
              ) : null}
              <Hairline />
            </View>
          );
        })}
      </View>
      {editing === "new" ? (
        <Section title="New job">
          <JobForm job={null} onSaved={() => setEditing(null)} />
        </Section>
      ) : (
        <Button
          label="Job"
          symbol="plus"
          variant="tinted"
          onPress={() => setEditing("new")}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.xl },
  jobRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  form: { paddingBottom: spacing.xl },
});
