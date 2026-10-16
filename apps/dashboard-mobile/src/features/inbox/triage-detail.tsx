import {
  Button,
  colors,
  Stack as Gap,
  haptics,
  Notice,
  Row,
  Screen,
  Section,
  spacing,
  Text,
} from "@repo/native-ui";
import {
  TRIAGE_CATEGORY_LABELS,
  type TriageSuggestionType,
} from "@repo/schemas";
import { Stack, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useArchiveTriage, useDecideSuggestion, useTriage } from "@/api/inbox";
import { QueryState } from "@/features/shell/tab-page";
import { clock, dayLabel } from "@/lib/format";

interface Suggestion {
  id: string;
  type: TriageSuggestionType;
  title: string;
  detail?: string;
  status: "pending" | "accepted" | "dismissed";
}

export function TriageDetail({ id }: { id: string }) {
  const router = useRouter();
  const detail = useTriage(id);
  const decide = useDecideSuggestion();
  const archive = useArchiveTriage();
  const triage = detail.data?.triage;
  const email = detail.data?.email;

  const suggestions: Suggestion[] = triage
    ? [
        ...triage.suggestedTasks.map((task) => ({
          id: task._id,
          type: "task" as const,
          title: task.title,
          detail: [
            task.dueDate ? `Due ${dayLabel(task.dueDate)}` : null,
            task.courseName ?? task.kanbanBoardTitle,
          ]
            .filter(Boolean)
            .join(" · "),
          status: task.status,
        })),
        ...triage.suggestedEvents.map((event) => ({
          id: event._id,
          type: "event" as const,
          title: event.title,
          detail: [`${dayLabel(event.date)} ${clock(event.date)}`, event.place]
            .filter(Boolean)
            .join(" · "),
          status: event.status,
        })),
        ...triage.suggestedActions.map((action) => ({
          id: action._id,
          type: "action" as const,
          title: action.summary,
          detail: action.tool,
          status: action.status,
        })),
      ]
    : [];

  const sender = email?.from[0];

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: triage ? TRIAGE_CATEGORY_LABELS[triage.category] : "",
        }}
      />
      <QueryState error={detail.error} loading={!detail.data} />
      {decide.error ? <Notice message={decide.error.message} /> : null}
      {triage && email ? (
        <Gap>
          <View style={styles.head}>
            <Text variant="title3">{email.subject || "(no subject)"}</Text>
            <Text variant="subheadline" tone="secondary">
              {sender?.name || sender?.address} · {dayLabel(email.date)}{" "}
              {clock(email.date)}
            </Text>
            {triage.summary ? (
              <Text variant="body" style={{ marginTop: spacing.sm }}>
                {triage.summary}
              </Text>
            ) : null}
          </View>

          <Section title="Suggestions">
            {suggestions.length === 0 ? (
              <Text tone="tertiary">—</Text>
            ) : (
              suggestions.map((suggestion) => (
                <View key={suggestion.id} style={styles.suggestion}>
                  <Row
                    title={suggestion.title}
                    subtitle={suggestion.detail || undefined}
                    value={
                      suggestion.status === "pending"
                        ? undefined
                        : suggestion.status
                    }
                    separator={suggestion.status !== "pending"}
                  />
                  {suggestion.status === "pending" ? (
                    <View style={styles.actions}>
                      <Button
                        label="Accept"
                        size="small"
                        symbol="checkmark"
                        block={false}
                        onPress={() => {
                          haptics.success();
                          decide.mutate({
                            triageId: id,
                            suggestionId: suggestion.id,
                            type: suggestion.type,
                            action: "accept",
                          });
                        }}
                      />
                      <Button
                        label="Dismiss"
                        size="small"
                        variant="tinted"
                        block={false}
                        onPress={() =>
                          decide.mutate({
                            triageId: id,
                            suggestionId: suggestion.id,
                            type: suggestion.type,
                            action: "dismiss",
                          })
                        }
                      />
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </Section>

          <Section title="Message">
            <Text variant="callout" numberOfLines={24}>
              {email.body?.text.trim() || "—"}
            </Text>
            <Row
              title="Open in Mail"
              chevron
              separator={false}
              onPress={() =>
                router.push(`/inbox/mail/${email.accountId}/${email._id}`)
              }
            />
          </Section>

          {triage.userStatus !== "archived" ? (
            <Button
              label="Archive"
              variant="tinted"
              loading={archive.isPending}
              onPress={() =>
                archive.mutate(id, { onSuccess: () => router.back() })
              }
            />
          ) : null}
        </Gap>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: spacing.xs },
  suggestion: { paddingBottom: spacing.sm },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
});
