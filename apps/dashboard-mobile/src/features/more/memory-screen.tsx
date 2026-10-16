import {
  colors,
  Stack as Gap,
  Notice,
  Row,
  Screen,
  Section,
  spacing,
  Text,
} from "@repo/native-ui";
import type { AgentMemoryCandidate } from "@repo/schemas";
import { Stack, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useDecideCandidate, useMemory, useMemoryReview } from "@/api/more";
import { SwipeRow } from "@/features/shell/swipe-row";
import { Dash, QueryState } from "@/features/shell/tab-page";
import { ago } from "@/lib/format";

function meta(candidate: AgentMemoryCandidate) {
  return [
    candidate.memoryType,
    `${Math.round(candidate.confidence * 100)}%`,
    ...candidate.reviewFlags,
  ].join(" · ");
}

/** Pending candidates: right to keep, left to drop. */
export function MemoryReviewScreen() {
  const router = useRouter();
  const review = useMemoryReview();
  const decide = useDecideCandidate();
  const candidates = review.data?.candidates ?? [];
  return (
    <Screen
      onRefresh={() => void review.refetch()}
      refreshing={review.isRefetching}
    >
      <Stack.Screen options={{ title: "Memory review" }} />
      {decide.error ? <Notice message={decide.error.message} /> : null}
      <QueryState error={review.error} loading={!review.data} />
      {review.data && candidates.length === 0 ? <Dash /> : null}
      {candidates.map((candidate) => (
        <SwipeRow
          key={candidate.id}
          right={{
            label: "Keep",
            symbol: "checkmark",
            color: colors.working,
            run: () => decide.mutate({ id: candidate.id, action: "accept" }),
          }}
          left={{
            label: "Drop",
            symbol: "xmark",
            color: colors.secondaryLabel,
            run: () => decide.mutate({ id: candidate.id, action: "dismiss" }),
          }}
        >
          <View style={styles.candidate}>
            <Text variant="body">{candidate.statement}</Text>
            <Text variant="footnote" tone="secondary">
              {meta(candidate)} · {ago(candidate.createdAt)}
            </Text>
            <Text variant="footnote" tone="tertiary" numberOfLines={3}>
              {candidate.reason}
            </Text>
            {[
              ...candidate.conflictingMemoryIds,
              ...candidate.supersedesMemoryIds,
            ].map((memoryId) => (
              <Text
                key={memoryId}
                variant="footnote"
                weight="semibold"
                onPress={() => router.push(`/more/memory/${memoryId}`)}
              >
                {candidate.supersedesMemoryIds.includes(memoryId)
                  ? "Replaces a memory"
                  : "Conflicts with a memory"}
              </Text>
            ))}
          </View>
          <View style={styles.rule} />
        </SwipeRow>
      ))}
    </Screen>
  );
}

/** Read-only: editing a memory is a desk job. */
export function MemoryScreen({ id }: { id: string }) {
  const memory = useMemory(id);
  const data = memory.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: "Memory" }} />
      <QueryState error={memory.error} loading={!data} />
      {data ? (
        <Gap>
          <Text variant="title3" selectable>
            {data.statement}
          </Text>
          <Section title="Details">
            <Row title="Type" value={data.memoryType} />
            <Row title="Status" value={data.status} />
            <Row
              title="Confidence"
              value={`${Math.round(data.confidence * 100)}%`}
            />
            <Row
              title="Importance"
              value={`${Math.round(data.importance * 100)}%`}
            />
            <Row title="Revision" value={String(data.revision)} />
            <Row
              title="Updated"
              value={ago(data.updatedAt)}
              separator={false}
            />
          </Section>
        </Gap>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  candidate: { paddingVertical: spacing.md, gap: spacing.xs },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
});
