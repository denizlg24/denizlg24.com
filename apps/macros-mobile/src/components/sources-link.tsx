import {
  CITATION_TOPICS,
  CITATIONS,
  type CitationTopicKey,
} from "@repo/macros-core/citations";
import { useRouter, useSegments } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { Pressable, StyleSheet } from "react-native";
import { colors, Icon, spacing, Text, VStack } from "@/ui";

/**
 * The citation link under a calculated figure. Onboarding is its own stack
 * outside the signed-in app, so it carries its own copy of the screen.
 */
export function SourcesLink({ topic }: { topic: CitationTopicKey }) {
  const router = useRouter();
  const segments = useSegments();
  const entry = CITATION_TOPICS.find((entry) => entry.key === topic);
  if (!entry) return null;
  const title = entry.title;
  const pathname =
    segments[0] === "onboarding" ? "/onboarding/sources" : "/more/sources";

  return (
    <VStack gap={spacing.xs}>
      <Text variant="footnote" weight="semibold">
        Health references: {title}
      </Text>
      {entry.citations.slice(0, 2).map((id) => {
        const citation = CITATIONS[id];
        return (
          <Pressable
            key={id}
            onPress={() => void openBrowserAsync(citation.url)}
            accessibilityRole="link"
            accessibilityLabel={`Source: ${citation.title}. ${citation.source}. ${citation.supports}`}
            accessibilityHint="Opens the original reference in your browser"
            style={({ pressed }) => [
              styles.reference,
              pressed && { opacity: 0.5 },
            ]}
          >
            <Text variant="footnote" style={styles.source}>
              {citation.source}
            </Text>
            <Text variant="footnote" tone="secondary">
              {citation.supports}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => router.push({ pathname, params: { topic } })}
        accessibilityRole="link"
        accessibilityLabel={`All health references and calculation details: ${title}`}
        style={({ pressed }) => [styles.link, pressed && { opacity: 0.5 }]}
      >
        <Icon name="book-open" size={16} color={colors.link} />
        <Text variant="footnote" style={[styles.source, styles.detailsLabel]}>
          All references & calculation details
        </Text>
      </Pressable>
    </VStack>
  );
}

/** One link per topic, stacked under the figures they explain. */
export function SourcesLinks({ topics }: { topics: CitationTopicKey[] }) {
  return (
    <VStack gap={spacing.lg}>
      {topics.map((topic) => (
        <SourcesLink key={topic} topic={topic} />
      ))}
    </VStack>
  );
}

const styles = StyleSheet.create({
  source: {
    color: colors.link,
    textDecorationLine: "underline",
  },
  detailsLabel: {
    flexShrink: 1,
  },
  reference: {
    gap: spacing.xxs,
    paddingVertical: spacing.xs,
    minHeight: 44,
  },
  link: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
  },
});
