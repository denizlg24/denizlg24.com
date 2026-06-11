import {
  Document,
  Font,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { ReactNode } from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

Font.registerEmojiSource({
  format: "png",
  url: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/",
});

Font.register({
  family: "Inter",
  fonts: [
    {
      src: "/assets/fonts/inter-regular.ttf",
      fontWeight: 400,
    },
    {
      src: "/assets/fonts/inter-regular.ttf",
      fontWeight: 400,
      fontStyle: "italic",
    },
    {
      src: "/assets/fonts/inter-bold.ttf",
      fontWeight: 700,
    },
  ],
});

Font.register({
  family: "FiraCode",
  fonts: [
    {
      src: "/assets/fonts/firacode-regular.ttf",
      fontWeight: 400,
    },
    {
      src: "/assets/fonts/firacode-regular.ttf",
      fontWeight: 400,
      fontStyle: "italic",
    },
  ],
});

const colors = {
  text: "#303630",
  textLight: "#778873",
  surface: "#f1f3e0",
  muted: "#d2dcb6",
  accent: "#a1bc98",
  bg: "#f9f8f6",
  codeBg: "#252a25",
  codeText: "#d2dcb6",
};

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Inter",
    fontSize: 11,
    lineHeight: 1.6,
    color: colors.text,
    backgroundColor: "white",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.muted,
    paddingBottom: 8,
    marginBottom: 20,
  },
  headerText: {
    fontSize: 9,
    color: colors.textLight,
  },
  headerTitle: {
    fontSize: 9,
    fontFamily: "FiraCode",
    color: colors.textLight,
  },
  paragraph: {
    marginBottom: 12,
    fontSize: 11,
    lineHeight: 1.6,
  },
  h1: {
    fontSize: 26,
    fontFamily: "Inter",
    fontWeight: 700,
    marginTop: 28,
    marginBottom: 8,
    lineHeight: 1.1,
    color: colors.text,
  },
  h2: {
    fontSize: 22,
    fontFamily: "Inter",
    fontWeight: 700,
    marginTop: 24,
    marginBottom: 8,
    lineHeight: 1.15,
    color: colors.text,
  },
  h3: {
    fontSize: 18,
    fontFamily: "Inter",
    fontWeight: 700,
    marginTop: 20,
    marginBottom: 8,
    lineHeight: 1.2,
    color: colors.text,
  },
  h4: {
    fontSize: 15,
    fontFamily: "Inter",
    fontWeight: 700,
    marginTop: 16,
    marginBottom: 6,
    lineHeight: 1.25,
    color: colors.text,
  },
  h5: {
    fontSize: 13,
    fontFamily: "Inter",
    fontWeight: 700,
    marginTop: 14,
    marginBottom: 6,
    lineHeight: 1.3,
    color: colors.text,
  },
  h6: {
    fontSize: 11,
    fontFamily: "Inter",
    fontWeight: 700,
    marginTop: 12,
    marginBottom: 6,
    lineHeight: 1.3,
    color: colors.text,
  },
  bold: {
    fontFamily: "Inter",
    fontWeight: 700,
  },
  italic: {
    fontStyle: "italic",
  },
  strikethrough: {
    textDecoration: "line-through",
  },
  inlineCode: {
    fontFamily: "FiraCode",
    fontSize: 10,
    backgroundColor: colors.surface,
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 2,
  },
  codeBlock: {
    backgroundColor: colors.codeBg,
    padding: 12,
    marginVertical: 12,
    borderRadius: 4,
  },
  codeText: {
    fontFamily: "FiraCode",
    fontSize: 9,
    lineHeight: 1.5,
    color: colors.codeText,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.textLight,
    paddingLeft: 16,
    marginVertical: 12,
    marginLeft: 0,
  },
  blockquoteText: {
    fontStyle: "italic",
    color: colors.textLight,
  },
  list: {
    marginBottom: 12,
    paddingLeft: 8,
  },
  listItem: {
    flexDirection: "row",
    marginBottom: 4,
  },
  listBullet: {
    width: 20,
    fontSize: 11,
    color: colors.textLight,
  },
  listContent: {
    flex: 1,
    fontSize: 11,
    lineHeight: 1.6,
  },
  link: {
    color: colors.text,
    textDecoration: "underline",
  },
  hr: {
    borderBottomWidth: 1,
    borderBottomColor: colors.muted,
    marginVertical: 24,
  },
  table: {
    marginVertical: 12,
    borderWidth: 1,
    borderColor: colors.muted,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.muted,
  },
  tableHeaderCell: {
    flex: 1,
    padding: 8,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.muted,
  },
  tableHeaderText: {
    fontFamily: "Inter",
    fontWeight: 700,
    fontSize: 10,
  },
  tableCell: {
    flex: 1,
    padding: 8,
    borderRightWidth: 1,
    borderRightColor: colors.muted,
  },
  tableCellText: {
    fontSize: 10,
  },
  mathBlock: {
    backgroundColor: colors.surface,
    padding: 12,
    marginVertical: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.muted,
  },
  mathText: {
    fontFamily: "FiraCode",
    fontSize: 10,
    color: colors.textLight,
  },
  checkbox: {
    fontFamily: "FiraCode",
    fontSize: 11,
    marginRight: 4,
  },
});

const headingStyles: Record<number, (typeof styles)["h1"]> = {
  1: styles.h1,
  2: styles.h2,
  3: styles.h3,
  4: styles.h4,
  5: styles.h5,
  6: styles.h6,
};

type MdNode = any;

function renderInline(node: MdNode, key: number): ReactNode {
  switch (node.type) {
    case "text":
      return node.value;

    case "strong":
      return (
        <Text key={key} style={styles.bold}>
          {node.children.map((c: MdNode, i: number) => renderInline(c, i))}
        </Text>
      );

    case "emphasis":
      return (
        <Text key={key} style={styles.italic}>
          {node.children.map((c: MdNode, i: number) => renderInline(c, i))}
        </Text>
      );

    case "delete":
      return (
        <Text key={key} style={styles.strikethrough}>
          {node.children.map((c: MdNode, i: number) => renderInline(c, i))}
        </Text>
      );

    case "inlineCode":
      return (
        <Text key={key} style={styles.inlineCode}>
          {node.value}
        </Text>
      );

    case "link":
      return (
        <Link key={key} src={node.url} style={styles.link}>
          {node.children.map((c: MdNode, i: number) => renderInline(c, i))}
        </Link>
      );

    case "image":
      return (
        <Text key={key} style={styles.italic}>
          [{node.alt || "image"}]
        </Text>
      );

    case "inlineMath":
      return (
        <Text key={key} style={styles.inlineCode}>
          {node.value}
        </Text>
      );

    case "break":
      return "\n";

    default:
      if (node.children) {
        return node.children.map((c: MdNode, i: number) => renderInline(c, i));
      }
      return node.value || null;
  }
}

function renderListItem(
  node: MdNode,
  key: number,
  ordered: boolean,
  startIndex: number,
): ReactNode {
  const bullet = ordered ? `${startIndex + key}.` : "\u2022";
  const isTaskItem = node.checked !== null && node.checked !== undefined;
  const checkbox = isTaskItem ? (node.checked ? "[x] " : "[ ] ") : "";

  return (
    <View key={key} style={styles.listItem}>
      <Text style={styles.listBullet}>{bullet}</Text>
      <View style={styles.listContent}>
        {node.children.map((child: MdNode, i: number) => {
          if (child.type === "paragraph") {
            return (
              <Text key={i} style={{ fontSize: 11, lineHeight: 1.6 }}>
                {isTaskItem && <Text style={styles.checkbox}>{checkbox}</Text>}
                {child.children.map((c: MdNode, j: number) =>
                  renderInline(c, j),
                )}
              </Text>
            );
          }
          if (child.type === "list") {
            return (
              <View key={i} style={styles.list}>
                {child.children.map((item: MdNode, j: number) =>
                  renderListItem(item, j, child.ordered, child.start || 1),
                )}
              </View>
            );
          }
          return renderBlock(child, i);
        })}
      </View>
    </View>
  );
}

function renderTable(node: MdNode, key: number): ReactNode {
  const rows = node.children;
  if (!rows || rows.length === 0) return null;

  const headerRow = rows[0];
  const bodyRows = rows.slice(1);

  return (
    <View key={key} style={styles.table} wrap={false}>
      <View style={styles.tableRow}>
        {headerRow.children.map((cell: MdNode, i: number) => (
          <View key={i} style={styles.tableHeaderCell}>
            <Text style={styles.tableHeaderText}>
              {cell.children.map((c: MdNode, j: number) => renderInline(c, j))}
            </Text>
          </View>
        ))}
      </View>
      {bodyRows.map((row: MdNode, rowI: number) => (
        <View key={rowI} style={styles.tableRow}>
          {row.children.map((cell: MdNode, cellI: number) => (
            <View key={cellI} style={styles.tableCell}>
              <Text style={styles.tableCellText}>
                {cell.children.map((c: MdNode, j: number) =>
                  renderInline(c, j),
                )}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function renderBlock(node: MdNode, key: number): ReactNode {
  switch (node.type) {
    case "heading":
      return (
        <Text
          key={key}
          style={headingStyles[node.depth] || styles.h6}
          minPresenceAhead={40}
        >
          {node.children.map((c: MdNode, i: number) => renderInline(c, i))}
        </Text>
      );

    case "paragraph":
      return (
        <Text key={key} style={styles.paragraph}>
          {node.children.map((c: MdNode, i: number) => renderInline(c, i))}
        </Text>
      );

    case "code":
      return (
        <View key={key} style={styles.codeBlock} wrap={false}>
          <Text style={styles.codeText}>{node.value}</Text>
        </View>
      );

    case "blockquote":
      return (
        <View key={key} style={styles.blockquote} wrap={false}>
          {node.children.map((child: MdNode, i: number) => {
            if (child.type === "paragraph") {
              return (
                <Text key={i} style={[styles.paragraph, styles.blockquoteText]}>
                  {child.children.map((c: MdNode, j: number) =>
                    renderInline(c, j),
                  )}
                </Text>
              );
            }
            return renderBlock(child, i);
          })}
        </View>
      );

    case "list":
      return (
        <View key={key} style={styles.list}>
          {node.children.map((item: MdNode, i: number) =>
            renderListItem(item, i, node.ordered, node.start || 1),
          )}
        </View>
      );

    case "listItem":
      return renderListItem(node, key, false, 0);

    case "thematicBreak":
      return <View key={key} style={styles.hr} />;

    case "table":
      return renderTable(node, key);

    case "math":
      return (
        <View key={key} style={styles.mathBlock} wrap={false}>
          <Text style={styles.mathText}>{node.value}</Text>
        </View>
      );

    case "html":
      return null;

    default:
      if (node.children) {
        return (
          <View key={key}>
            {node.children.map((c: MdNode, i: number) => renderBlock(c, i))}
          </View>
        );
      }
      if (node.value) {
        return (
          <Text key={key} style={styles.paragraph}>
            {node.value}
          </Text>
        );
      }
      return null;
  }
}

interface MarkdownPdfDocumentProps {
  content: string;
  title?: string;
  showHeader?: boolean;
}

export function MarkdownPdfDocument({
  content,
  title,
  showHeader = true,
}: MarkdownPdfDocumentProps) {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(content);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {showHeader && (
          <View style={styles.header} fixed>
            <Text style={styles.headerText}>denizlg24</Text>
            <Text style={styles.headerTitle}>{title || "note"}.md</Text>
            <Text style={styles.headerText}>
              {new Date().toLocaleDateString()}
            </Text>
          </View>
        )}
        {tree.children.map((child: MdNode, i: number) => renderBlock(child, i))}
      </Page>
    </Document>
  );
}
