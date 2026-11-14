import { colors, fonts, Hairline, Row, spacing, Text } from "@repo/native-ui";
import {
  type Block,
  parseEntityRef,
  type RecordSummary,
  type RichText,
} from "@repo/schemas";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as WebBrowser from "expo-web-browser";
import { createContext, useContext, useState } from "react";
import {
  Text as NativeText,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { nativeRecord, WorkspaceViewBlock } from "./view-block";

export const PageTitles = createContext<Record<string, string>>({});
export const EmbeddedRecords = createContext<{
  records: Record<string, RecordSummary>;
  missing: string[];
  loading: boolean;
}>({ records: {}, missing: [], loading: false });

export function InlineText({ runs }: { runs: RichText }) {
  const router = useRouter();
  const titles = useContext(PageTitles);
  return (
    <>
      {runs.map((run, index) =>
        run.type === "mention" ? (
          <NativeText
            key={`${index}-${run.id}`}
            style={{ fontFamily: fonts.medium }}
            onPress={
              run.kind === "page"
                ? () =>
                    router.push({
                      pathname: "/more/page/[id]",
                      params: { id: run.id },
                    })
                : undefined
            }
          >
            {(run.kind === "page" ? titles[run.id] : undefined) ||
              run.label ||
              (run.kind === "date"
                ? run.id
                : run.kind === "page"
                  ? "Linked page"
                  : run.kind)}
          </NativeText>
        ) : (
          <NativeText
            key={`${index}-${run.text}`}
            style={{
              fontFamily: run.code
                ? "Menlo"
                : run.bold
                  ? fonts.bold
                  : undefined,
              ...(run.italic ? { fontStyle: "italic" as const } : {}),
              ...(run.strike
                ? { textDecorationLine: "line-through" as const }
                : run.link
                  ? { textDecorationLine: "underline" as const }
                  : {}),
            }}
            onPress={
              run.link && /^https?:\/\//i.test(run.link)
                ? () => void WebBrowser.openBrowserAsync(run.link!)
                : undefined
            }
          >
            {run.text}
          </NativeText>
        ),
      )}
    </>
  );
}

type Props = {
  blocks: Block[];
  disabled: boolean;
  onTodo: (id: string, checked: boolean) => void;
  onDesktop: () => void;
  depth?: number;
};

/** Flow stays in document order; desktop columns become vertical groups on a phone. */
export function DocumentBlocks({ blocks, depth = 0, ...rest }: Props) {
  let listNumber = 0;
  if (depth > 20)
    return <Row title="Open nested content on web" onPress={rest.onDesktop} />;
  return (
    <View style={styles.flow}>
      {blocks.map((block) => {
        listNumber = block.type === "numbered" ? listNumber + 1 : 0;
        return (
          <DocumentBlock
            key={block.id}
            block={block}
            index={listNumber - 1}
            depth={depth}
            {...rest}
          />
        );
      })}
    </View>
  );
}

function DocumentBlock({
  block,
  index,
  depth,
  disabled,
  onTodo,
  onDesktop,
}: Omit<Props, "blocks"> & { block: Block; index: number; depth: number }) {
  const router = useRouter();
  const titles = useContext(PageTitles);
  const [expanded, setExpanded] = useState(false);
  const embedded = useContext(EmbeddedRecords);
  const children =
    "children" in block && block.children.length > 0 ? (
      <View
        style={
          block.type === "columns" ||
          block.type === "column" ||
          block.type === "section"
            ? undefined
            : styles.indent
        }
      >
        <DocumentBlocks
          blocks={block.children}
          disabled={disabled}
          onTodo={onTodo}
          onDesktop={onDesktop}
          depth={depth + 1}
        />
      </View>
    ) : null;
  const nativeLink = (
    title: string,
    route:
      | "/calendar"
      | "/money"
      | "/inbox"
      | "/more/notes"
      | "/more/board"
      | "/more/resources"
      | "/more/tasks"
      | "/today"
      | "/chat",
  ) => <Row title={title} chevron onPress={() => router.push(route)} />;
  switch (block.type) {
    case "view":
      return <WorkspaceViewBlock block={block} onDesktop={onDesktop} />;
    case "paragraph":
      return (
        <Text selectable>
          <InlineText runs={block.text} />
        </Text>
      );
    case "heading":
      return (
        <Text
          accessibilityRole="header"
          variant={block.level === 1 ? "title2" : "title3"}
          style={styles.heading}
        >
          <InlineText runs={block.text} />
        </Text>
      );
    case "bullet":
    case "numbered":
      return (
        <View>
          <View style={styles.line}>
            <Text>{block.type === "bullet" ? "•" : `${index + 1}.`}</Text>
            <Text selectable style={styles.flex}>
              <InlineText runs={block.text} />
            </Text>
          </View>
          {children}
        </View>
      );
    case "todo":
      return (
        <View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: block.checked, disabled }}
            disabled={disabled}
            onPress={() => onTodo(block.id, !block.checked)}
            style={({ pressed }) => [
              styles.line,
              styles.control,
              pressed && styles.pressed,
            ]}
          >
            <SymbolView
              name={block.checked ? "checkmark.square.fill" : "square"}
              size={22}
              tintColor={colors.tint}
            />
            <Text style={[styles.flex, block.checked && styles.checked]}>
              <InlineText runs={block.text} />
            </Text>
          </Pressable>
          {children}
        </View>
      );
    case "toggle":
      return (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(!expanded)}
            style={({ pressed }) => [
              styles.line,
              styles.control,
              pressed && styles.pressed,
            ]}
          >
            <SymbolView
              name={expanded ? "chevron.down" : "chevron.right"}
              size={14}
              tintColor={colors.tint}
            />
            <Text weight="semibold" style={styles.flex}>
              <InlineText runs={block.text} />
            </Text>
          </Pressable>
          {expanded ? children : null}
        </View>
      );
    case "callout":
    case "quote":
      return (
        <View style={styles.callout}>
          <Text
            selectable
            style={block.type === "quote" ? styles.quote : undefined}
          >
            <InlineText runs={block.text} />
          </Text>
          {children}
        </View>
      );
    case "columns":
    case "column":
      return children;
    case "section":
      return (
        <View style={styles.flow}>
          {block.title ? <Text variant="title3">{block.title}</Text> : null}
          {children}
        </View>
      );
    case "divider":
      return <Hairline style={styles.heading} />;
    case "code":
      return (
        <ScrollView horizontal>
          <Text selectable style={styles.code}>
            {block.code}
          </Text>
        </ScrollView>
      );
    case "equation":
      return (
        <Text selectable style={styles.code}>
          {block.expression}
        </Text>
      );
    case "image":
      return block.url ? (
        <View style={styles.flow}>
          <Image
            source={{ uri: block.url }}
            style={styles.image}
            contentFit="contain"
            accessibilityLabel={
              block.caption
                .map((run) =>
                  run.type === "text" ? run.text : (run.label ?? ""),
                )
                .join("") || "Page image"
            }
          />
          <Text variant="footnote" tone="secondary">
            <InlineText runs={block.caption} />
          </Text>
        </View>
      ) : (
        <Text tone="secondary">No image attached.</Text>
      );
    case "file":
    case "bookmark":
    case "embed":
      return (
        <Row
          title={
            block.type === "file"
              ? block.name || "Attachment"
              : block.type === "bookmark"
                ? block.title || block.url || "Bookmark"
                : "Open embedded content"
          }
          subtitle={block.url}
          chevron
          onPress={
            /^https?:\/\//i.test(block.url)
              ? () => void WebBrowser.openBrowserAsync(block.url)
              : undefined
          }
        />
      );
    case "table":
      return (
        <ScrollView horizontal>
          <View>
            {block.rows.map((row, rowIndex) => (
              <View key={`${block.id}-${rowIndex}`} style={styles.tableRow}>
                {row.map((cell, cellIndex) => (
                  <Text
                    key={`${block.id}-${rowIndex}-${cellIndex}`}
                    selectable
                    weight={
                      block.headerRow && rowIndex === 0 ? "semibold" : undefined
                    }
                    style={styles.cell}
                  >
                    <InlineText runs={cell} />
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    case "record": {
      const ref = parseEntityRef(block.ref);
      const route = nativeRecord(block.ref);
      const record = embedded.records[block.ref];
      const missing = embedded.missing.includes(block.ref);
      return (
        <Row
          title={
            record?.title ||
            (ref?.kind === "page"
              ? titles[ref.id] || "Linked page"
              : missing
                ? "Record unavailable"
                : embedded.loading
                  ? "Loading record…"
                  : "Linked record")
          }
          titleLines={0}
          subtitle={
            record
              ? [
                  record.subtitle,
                  ...record.fields.map(
                    (field) => `${field.label}: ${field.value}`,
                  ),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : !ref
                ? "No record selected"
                : route
                  ? undefined
                  : "Open on web"
          }
          chevron={!!ref && !missing}
          onPress={
            missing
              ? undefined
              : route
                ? () => router.push(route)
                : ref
                  ? onDesktop
                  : undefined
          }
        />
      );
    }
    case "synced":
      return (
        <Row
          title="Open source page"
          chevron
          onPress={() =>
            router.push({
              pathname: "/more/page/[id]",
              params: { id: block.pageId },
            })
          }
        />
      );
    case "links":
      return (
        <View>
          {block.refs.map((ref) => (
            <Row
              key={ref}
              title={
                ref.startsWith("page:")
                  ? titles[ref.slice(5)] || "Linked page"
                  : ref.slice(7)
              }
              chevron
              onPress={
                ref.startsWith("page:")
                  ? () =>
                      router.push({
                        pathname: "/more/page/[id]",
                        params: { id: ref.slice(5) },
                      })
                  : onDesktop
              }
            />
          ))}
        </View>
      );
    case "agenda":
    case "semester":
      return nativeLink(block.title || "Calendar", "/calendar");
    case "tasks":
      return nativeLink(block.title || "Tasks", "/today");
    case "alerts":
      return nativeLink(block.title || "Alerts", "/today");
    case "budget":
      return nativeLink(block.title || "Budget", "/money");
    case "resources":
      return nativeLink(block.title || "Resources", "/more/resources");
    case "notes":
      return nativeLink(block.title || "Notes", "/more/notes");
    case "contacts":
      return nativeLink(block.title || "Inbox", "/inbox");
    case "board":
      return nativeLink(block.title || "Board", "/more/board");
    case "agent":
      return nativeLink(block.title || "Agent", "/chat");
    case "subpages":
    case "breadcrumb":
      return null; // Page-level navigation renders these once, outside the document.
    case "greeting":
      return <Text variant="title2">Welcome back</Text>;
    case "button":
      return (
        <Row
          title={block.label || "Workspace action"}
          subtitle="Run this action on web"
          chevron
          onPress={onDesktop}
        />
      );
    default:
      return (
        <Row
          title={
            "title" in block && block.title
              ? block.title
              : `${block.type.charAt(0).toUpperCase()}${block.type.slice(1)}`
          }
          subtitle="Open this block on web"
          chevron
          onPress={onDesktop}
        />
      );
  }
}

const styles = StyleSheet.create({
  flow: { gap: spacing.md },
  heading: { marginTop: spacing.md },
  line: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  control: { minHeight: 44, alignItems: "center" },
  flex: { flex: 1 },
  indent: { paddingLeft: spacing.xl, paddingTop: spacing.sm },
  pressed: { opacity: 0.55 },
  checked: { textDecorationLine: "line-through", color: colors.secondaryLabel },
  callout: { paddingVertical: spacing.sm, gap: spacing.sm },
  quote: { fontStyle: "italic" },
  code: { fontFamily: "Menlo", paddingVertical: spacing.sm },
  image: { width: "100%", height: 240 },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  cell: { width: 180, padding: spacing.sm },
});
