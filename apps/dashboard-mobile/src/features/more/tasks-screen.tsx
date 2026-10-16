import {
  Button,
  Stack as Gap,
  haptics,
  Notice,
  Row,
  Screen,
  Section,
  spacing,
  Text,
} from "@repo/native-ui";
import type { AgentTask, AgentUIMessage } from "@repo/schemas";
import { Stack, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useRunTask, useSetTaskStatus, useTaskRun, useTasks } from "@/api/more";
import { blocksOf } from "@/features/agent/parts";
import { Dash, QueryState } from "@/features/shell/tab-page";
import { ago, clock, dayLabel, until } from "@/lib/format";

const RUN_TONE = {
  queued: "secondary",
  running: "working",
  completed: "secondary",
  failed: "destructive",
} as const;

function nextRun(task: AgentTask) {
  if (task.status === "paused") return "paused";
  return task.nextRunAt ? until(task.nextRunAt) : undefined;
}

/** Tasks and their recent runs. Authoring a task stays on web. */
export function TasksScreen() {
  const router = useRouter();
  const tasks = useTasks();
  const run = useRunTask();
  const status = useSetTaskStatus();
  const data = tasks.data;
  const active = data?.tasks.filter((task) => task.status !== "archived") ?? [];

  return (
    <Screen
      onRefresh={() => void tasks.refetch()}
      refreshing={tasks.isRefetching}
    >
      <Stack.Screen options={{ title: "Tasks" }} />
      <QueryState error={tasks.error} loading={!data} />
      {run.error ? <Notice message={run.error.message} /> : null}
      {status.error ? <Notice message={status.error.message} /> : null}
      {data ? (
        <Gap>
          <Section title="Tasks">
            {active.length === 0 ? <Dash /> : null}
            {active.map((task) => (
              <View key={task.id} style={styles.task}>
                <Row
                  title={task.name}
                  subtitle={
                    task.schedule?.cron ??
                    (task.runAt
                      ? `once · ${dayLabel(task.runAt)} ${clock(task.runAt)}`
                      : undefined)
                  }
                  value={nextRun(task)}
                  separator={false}
                />
                <View style={styles.actions}>
                  <Button
                    label="Run now"
                    size="small"
                    variant="tinted"
                    block={false}
                    symbol="play.fill"
                    onPress={() => {
                      haptics.impact();
                      run.mutate(task.id, {
                        onSuccess: ({ run: started }) =>
                          router.push(`/more/run/${started.id}`),
                      });
                    }}
                  />
                  <Button
                    label={task.status === "paused" ? "Resume" : "Pause"}
                    size="small"
                    variant="plain"
                    block={false}
                    onPress={() =>
                      status.mutate({
                        taskId: task.id,
                        status: task.status === "paused" ? "active" : "paused",
                      })
                    }
                  />
                </View>
              </View>
            ))}
          </Section>
          <Section title="Runs">
            {data.runs.length === 0 ? <Dash /> : null}
            {data.runs.slice(0, 30).map((item, index, rows) => (
              <Row
                key={item.id}
                title={item.taskName}
                subtitle={item.error ?? item.outputPreview}
                value={
                  item.status === "completed"
                    ? ago(item.completedAt ?? item.updatedAt)
                    : item.status
                }
                valueTone={RUN_TONE[item.status]}
                separator={index < rows.length - 1}
                onPress={() => router.push(`/more/run/${item.id}`)}
              />
            ))}
          </Section>
        </Gap>
      ) : null}
    </Screen>
  );
}

function Transcript({ messages }: { messages: AgentUIMessage[] }) {
  return (
    <View style={{ gap: spacing.lg }}>
      {messages.map((message) => (
        <View key={message.id} style={{ gap: spacing.xs }}>
          {blocksOf(message).map((block) =>
            block.kind === "text" ? (
              <Text
                key={block.key}
                selectable
                tone={message.role === "user" ? "secondary" : "primary"}
              >
                {block.text}
              </Text>
            ) : block.kind === "tool" ? (
              <Text key={block.key} variant="footnote" tone="tertiary">
                ↳ {block.label}
              </Text>
            ) : block.kind === "notice" ? (
              <Text key={block.key} variant="footnote" tone="secondary">
                {block.text}
              </Text>
            ) : null,
          )}
        </View>
      ))}
    </View>
  );
}

/** One run's transcript, refreshed every two seconds while it is live. */
export function RunScreen({ id }: { id: string }) {
  const run = useTaskRun(id);
  const data = run.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: data?.taskName ?? "" }} />
      <QueryState error={run.error} loading={!data} />
      {data ? (
        <Gap>
          <Text variant="footnote" tone={RUN_TONE[data.status]}>
            {data.status} · {data.trigger}
            {data.startedAt
              ? ` · ${dayLabel(data.startedAt)} ${clock(data.startedAt)}`
              : ""}
            {data.tokenUsage ? ` · $${data.tokenUsage.costUsd.toFixed(3)}` : ""}
          </Text>
          {data.error ? <Notice message={data.error} /> : null}
          <Transcript messages={data.messages} />
        </Gap>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  task: { paddingBottom: spacing.sm },
  actions: { flexDirection: "row", gap: spacing.sm },
});
