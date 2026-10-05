import type {
  ChangelogBlock,
  ChangelogInline,
  ChangelogRelease,
} from "@repo/schemas";
import { compareVersions } from "@repo/utils/changelog";
import { openBrowserAsync } from "expo-web-browser";
import { Platform, StyleSheet, View } from "react-native";
import { useChangelog } from "@/api/changelog";
import { errorMessage, NetworkError } from "@/lib/api";
import { APP_VERSION } from "@/lib/config";
import {
  colors,
  EmptyState,
  Hairline,
  InlineNotice,
  Screen,
  Skeleton,
  spacing,
  Text,
} from "@/ui";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(date: string) {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}

export function ChangelogScreen() {
  const changelog = useChangelog();
  const releases = changelog.data;

  return (
    <Screen
      onRefresh={() => void changelog.refetch()}
      refreshing={changelog.isRefetching}
    >
      {changelog.isError && !releases ? (
        <InlineNotice
          tone={changelog.error instanceof NetworkError ? "offline" : "error"}
          message={
            changelog.error instanceof NetworkError
              ? "You’re offline. What’s new will load when you’re back."
              : `Couldn’t load what’s new. ${errorMessage(changelog.error)}`
          }
          action={{ label: "Retry", onPress: () => void changelog.refetch() }}
        />
      ) : null}
      {releases ? (
        releases.length > 0 ? (
          releases.map((release, index) => (
            <Release
              key={release.version}
              release={release}
              first={index === 0}
            />
          ))
        ) : (
          <EmptyState
            icon="file-text"
            title="Nothing here yet"
            message="Notes for each update will show up here."
          />
        )
      ) : changelog.isPending ? (
        <ReleaseSkeleton />
      ) : null}
    </Screen>
  );
}

function Release({
  release,
  first,
}: {
  release: ChangelogRelease;
  first: boolean;
}) {
  const order = compareVersions(release.version, APP_VERSION);
  const status =
    order === 0 ? "This version" : order > 0 ? "Not installed yet" : null;

  return (
    <View style={styles.release}>
      {first ? null : <Hairline style={styles.rule} />}
      <View style={styles.heading}>
        <Text variant="title3" figure>
          {release.version}
        </Text>
        {status ? (
          <Text
            variant="footnote"
            weight="semibold"
            tone={order === 0 ? "tint" : "secondary"}
          >
            {status}
          </Text>
        ) : null}
      </View>
      {release.date ? (
        <Text variant="footnote" tone="secondary">
          {formatDate(release.date)}
        </Text>
      ) : null}
      <View style={styles.sections}>
        {release.sections.map((section, index) => (
          <View key={section.title ?? `intro-${index}`} style={styles.section}>
            {section.title ? (
              <Text variant="footnote" tone="secondary" eyebrow>
                {section.title}
              </Text>
            ) : null}
            {section.blocks.map((block, blockIndex) => (
              <Block key={`${block.type}-${blockIndex}`} block={block} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function Block({ block }: { block: ChangelogBlock }) {
  if (block.type === "paragraph") {
    return (
      <Text variant="subheadline">
        <Inline content={block.content} />
      </Text>
    );
  }
  return (
    <View style={styles.list}>
      {block.items.map((item, index) => (
        <View key={index} style={styles.item}>
          <Text variant="subheadline" tone="tertiary">
            •
          </Text>
          <Text variant="subheadline" style={styles.itemText}>
            <Inline content={item} />
          </Text>
        </View>
      ))}
    </View>
  );
}

function Inline({ content }: { content: ChangelogInline[] }) {
  return content.map((token, index) => {
    const key = `${token.type}-${index}`;
    switch (token.type) {
      case "strong":
        return (
          <Text key={key} variant="subheadline" weight="semibold">
            {token.text}
          </Text>
        );
      case "code":
        return (
          <Text key={key} variant="subheadline" style={styles.code}>
            {token.text}
          </Text>
        );
      case "link":
        return (
          <Text
            key={key}
            variant="subheadline"
            tone="tint"
            accessibilityRole="link"
            onPress={() => void openBrowserAsync(token.href)}
          >
            {token.text}
          </Text>
        );
      default:
        return token.text;
    }
  });
}

function ReleaseSkeleton() {
  return (
    <View style={styles.release}>
      <Skeleton width={72} height={25} />
      <Skeleton width={120} height={18} />
      <View style={styles.sections}>
        <View style={styles.section}>
          <Skeleton width={56} height={18} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="80%" height={20} />
          <Skeleton width="90%" height={20} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  release: {
    gap: spacing.xs,
  },
  rule: {
    marginVertical: spacing.xxl,
  },
  heading: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sections: {
    gap: spacing.xl,
    marginTop: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  item: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  itemText: {
    flex: 1,
  },
  code: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    backgroundColor: colors.tertiaryFill,
  },
});
