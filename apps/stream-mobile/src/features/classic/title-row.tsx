import type { TitleSummary } from "@repo/schemas/stream";
import { Play } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { openTitle, playTitle } from "@/features/studio/open";
import { titleFacts } from "@/lib/format";
import { Button, colors, gutter, MetaRow, Poster, spacing, Text } from "@/ui";

/** Classic's list row: a large poster, the name, the year and a labelled Play. */
export function TitleRow({
  title,
  detail,
  progress,
  episodeId,
}: {
  title: TitleSummary;
  /** A second line: "45 minutes left", why it was picked. */
  detail?: string;
  progress?: number;
  episodeId?: string | null;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`More about ${title.title}`}
        onPress={() => openTitle(title.id)}
        style={({ pressed }) => [styles.main, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Poster title={title} width={96} progress={progress} />
        <View style={styles.copy}>
          <Text variant="classicHeading" numberOfLines={2}>
            {title.title}
          </Text>
          <MetaRow facts={titleFacts(title)} large />
          {detail ? (
            <Text variant="classicBody" numberOfLines={2}>
              {detail}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Button
          label={progress !== undefined ? "Carry on" : "Play"}
          icon={Play}
          filledIcon
          size="classic"
          onPress={() => playTitle(title.id, episodeId)}
        />
        <Button
          label="More about it"
          variant="secondary"
          size="classic"
          onPress={() => openTitle(title.id)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: gutter,
    paddingVertical: spacing.lg,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  main: { flexDirection: "row", gap: spacing.lg },
  copy: { flex: 1, gap: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
