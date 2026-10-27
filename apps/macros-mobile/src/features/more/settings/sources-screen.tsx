import {
  CITATION_TOPICS,
  CITATIONS,
  type CitationTopicKey,
  HEALTH_DISCLAIMER,
} from "@repo/macros-core/citations";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { Pressable, StyleSheet, View } from "react-native";
import {
  colors,
  Hairline,
  Icon,
  Screen,
  Section,
  spacing,
  Text,
  VStack,
} from "@/ui";
import { toolbarText } from "@/ui/toolbar";

/** Every source behind a calculated figure; `?topic=` puts that one first. */
export function SourcesScreen() {
  const router = useRouter();
  const { topic } = useLocalSearchParams<{ topic?: CitationTopicKey }>();
  const topics = [...CITATION_TOPICS].sort(
    (a, b) => Number(b.key === topic) - Number(a.key === topic),
  );

  return (
    <>
      <Stack.Toolbar placement="right">
        {toolbarText({
          variant: "done",
          onPress: () => router.back(),
          children: "Done",
        })}
      </Stack.Toolbar>
      <Screen>
        <VStack>
          <Text variant="footnote" tone="secondary">
            {HEALTH_DISCLAIMER}
          </Text>
          {topics.map((entry) => (
            <Section key={entry.key} title={entry.title}>
              <Text variant="subheadline" style={styles.summary}>
                {entry.summary}
              </Text>
              <Hairline />
              {entry.citations.map((id, index) => {
                const citation = CITATIONS[id];
                return (
                  <View key={id}>
                    <Pressable
                      onPress={() => void openBrowserAsync(citation.url)}
                      accessibilityRole="link"
                      accessibilityHint="Opens the source"
                      style={({ pressed }) => [
                        styles.citation,
                        pressed && { backgroundColor: colors.fill },
                      ]}
                    >
                      <View style={styles.citationText}>
                        <Text variant="subheadline">{citation.title}</Text>
                        <Text variant="footnote" tone="secondary">
                          {citation.source}
                        </Text>
                      </View>
                      <Icon
                        name="book-open"
                        size={16}
                        color={colors.tertiaryLabel}
                      />
                    </Pressable>
                    {index < entry.citations.length - 1 ? <Hairline /> : null}
                  </View>
                );
              })}
            </Section>
          ))}
        </VStack>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  summary: {
    marginBottom: spacing.md,
  },
  citation: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  citationText: {
    flex: 1,
    gap: spacing.xxs,
  },
});
