import type {
  MacrosRecipeBlock,
  MacrosRecipeInline,
} from "@repo/schemas/macros";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { RecipePhoto } from "@/components/recipe-photo";
import { colors, spacing } from "@/ui";

const serif = Platform.select({ ios: "Georgia", default: "serif" });

function openLink(href: string) {
  if (/^https?:\/\//i.test(href))
    void Linking.openURL(href).catch(() => undefined);
}

function Runs({ content }: { content: readonly MacrosRecipeInline[] }) {
  return content.map((run, index) => (
    <Text
      key={index}
      style={[
        run.bold && styles.bold,
        run.italic && styles.italic,
        run.href ? styles.link : null,
      ]}
      onPress={run.href ? () => openLink(run.href ?? "") : undefined}
      accessibilityRole={run.href ? "link" : undefined}
    >
      {run.text}
    </Text>
  ));
}

export function RecipeBlocks({
  blocks,
  fallbackLabel,
}: {
  blocks: readonly MacrosRecipeBlock[];
  fallbackLabel: string;
}) {
  return (
    <View style={styles.stack}>
      {blocks.map((block, index) => {
        const key = `${index}-${block.type}`;
        switch (block.type) {
          case "paragraph":
            return (
              <Text key={key} style={styles.prose}>
                <Runs content={block.content} />
              </Text>
            );
          case "heading":
            return (
              <Text key={key} style={styles.heading} accessibilityRole="header">
                {block.text}
              </Text>
            );
          case "quote":
            return (
              <Text key={key} style={[styles.prose, styles.quote]}>
                <Runs content={block.content} />
              </Text>
            );
          case "list":
            return (
              <View key={key} style={styles.list}>
                {block.items.map((item, itemIndex) => (
                  <View key={`${key}-${itemIndex}`} style={styles.item}>
                    <Text style={[styles.prose, styles.marker]}>
                      {block.ordered ? `${itemIndex + 1}.` : "•"}
                    </Text>
                    <Text style={[styles.prose, styles.itemText]}>
                      <Runs content={item} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          case "image":
            return block.imageUrl ? (
              <View key={key} style={styles.figure}>
                <RecipePhoto
                  url={block.imageUrl}
                  label={block.caption || fallbackLabel}
                />
                {block.caption ? (
                  <Text style={styles.caption}>{block.caption}</Text>
                ) : null}
              </View>
            ) : null;
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  prose: {
    fontFamily: serif,
    fontSize: 18,
    lineHeight: 28,
    color: colors.label,
  },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  link: { textDecorationLine: "underline" },
  heading: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "700",
    color: colors.label,
    marginTop: spacing.sm,
  },
  quote: {
    fontStyle: "italic",
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.label,
  },
  list: { gap: spacing.xs },
  item: { flexDirection: "row", gap: spacing.sm },
  marker: { minWidth: 18, color: colors.secondaryLabel },
  itemText: { flex: 1 },
  figure: { gap: spacing.xs },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.secondaryLabel,
    textAlign: "center",
  },
});
