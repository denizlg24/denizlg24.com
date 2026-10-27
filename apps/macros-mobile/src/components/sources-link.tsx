import {
  CITATION_TOPICS,
  type CitationTopicKey,
} from "@repo/macros-core/citations";
import { useRouter, useSegments } from "expo-router";
import { Pressable, StyleSheet } from "react-native";
import { colors, Icon, spacing, Text, VStack } from "@/ui";

/**
 * The citation link under a calculated figure. Onboarding is its own stack
 * outside the signed-in app, so it carries its own copy of the screen.
 */
export function SourcesLink({ topic }: { topic: CitationTopicKey }) {
  const router = useRouter();
  const segments = useSegments();
  const title = CITATION_TOPICS.find((entry) => entry.key === topic)?.title;
  const pathname =
    segments[0] === "onboarding" ? "/onboarding/sources" : "/more/sources";

  return (
    <Pressable
      onPress={() => router.push({ pathname, params: { topic } })}
      accessibilityRole="link"
      accessibilityLabel={`Sources: ${title}`}
      hitSlop={8}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.5 }]}
    >
      <Icon name="book-open" size={13} color={colors.secondaryLabel} />
      <Text variant="footnote" tone="secondary">
        Sources: {title}
      </Text>
    </Pressable>
  );
}

/** One link per topic, stacked under the figures they explain. */
export function SourcesLinks({ topics }: { topics: CitationTopicKey[] }) {
  return (
    <VStack gap={spacing.sm}>
      {topics.map((topic) => (
        <SourcesLink key={topic} topic={topic} />
      ))}
    </VStack>
  );
}

const styles = StyleSheet.create({
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
  },
});
