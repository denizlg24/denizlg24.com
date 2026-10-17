import {
  Button,
  colors,
  Hairline,
  haptics,
  Notice,
  Row,
  Screen,
  spacing,
  Text,
  typeScale,
} from "@repo/native-ui";
import {
  type IWhiteboardElement,
  imageDataSchema,
  markdownNoteDataSchema,
  pdfViewerDataSchema,
  quickLinksDataSchema,
  stickyNoteDataSchema,
  todoListDataSchema,
  whiteboardElementKind,
} from "@repo/schemas";
import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  useAddBoardElement,
  useBoard,
  useBoardItems,
  useBoardPicture,
  useClearDay,
  useRemoveBoardElement,
} from "@/api/board";
import { Dash, QueryState } from "@/features/shell/tab-page";

function openUrl(url: string) {
  void WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });
}

function menu(
  options: string[],
  destructive: number,
  run: (index: number) => void,
) {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      options: [...options, "Cancel"],
      cancelButtonIndex: options.length,
      destructiveButtonIndex: destructive,
    },
    (index) => {
      if (index < options.length) run(index);
    },
  );
}

/** Today's whiteboard: the rendered board, then each component as rows. */
export function BoardScreen() {
  const board = useBoard();
  const picture = useBoardPicture(board.data?.updatedAt);
  const add = useAddBoardElement();
  const clear = useClearDay();
  const router = useRouter();
  const elements = [...(board.data?.elements ?? [])].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  );

  const addComponent = () =>
    menu(["Todo list", "Sticky note", "Link list"], -1, (index) => {
      haptics.selection();
      if (index === 0) {
        add.mutate({
          type: "component",
          componentType: "todo-list",
          data: { items: [] },
        });
      } else if (index === 1) {
        add.mutate(
          {
            type: "component",
            componentType: "sticky-note",
            data: { content: "", colorIndex: 0 },
          },
          {
            onSuccess: ({ addedElementIds }) => {
              const id = addedElementIds[0];
              if (id) router.push(`/board-note?id=${id}`);
            },
          },
        );
      } else {
        add.mutate({
          type: "component",
          componentType: "quick-links",
          data: { title: "Links", links: [] },
        });
      }
    });

  const clearDay = () =>
    Alert.alert("Clear today's board?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          haptics.warning();
          clear.mutate();
        },
      },
    ]);

  return (
    <Screen
      onRefresh={() => void board.refetch()}
      refreshing={board.isRefetching}
    >
      <Stack.Screen
        options={{
          title: "Board",
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add"
              hitSlop={10}
              onPress={addComponent}
            >
              <SymbolView name="plus" size={18} tintColor={colors.label} />
            </Pressable>
          ),
        }}
      />
      <QueryState error={board.error} loading={!board.data} />
      {add.error ? <Notice message={add.error.message} /> : null}
      {picture.data ? (
        <Pressable onPress={() => router.push("/board-picture")}>
          <Image
            source={{ uri: picture.data.uri }}
            contentFit="contain"
            style={[
              styles.picture,
              {
                aspectRatio: Math.max(
                  picture.data.width / picture.data.height,
                  0.75,
                ),
              },
            ]}
          />
        </Pressable>
      ) : null}
      {board.data && elements.length === 0 ? <Dash /> : null}
      <View style={styles.components}>
        {elements.map((element) => (
          <BoardElement key={element.id} element={element} />
        ))}
      </View>
      {board.data && elements.length > 0 ? (
        <Button
          label="Clear day"
          variant="plain"
          size="small"
          block={false}
          loading={clear.isPending}
          onPress={clearDay}
          style={styles.clear}
        />
      ) : null}
    </Screen>
  );
}

function BoardElement({ element }: { element: IWhiteboardElement }) {
  const router = useRouter();
  const remove = useRemoveBoardElement();
  const askRemove = (name: string) =>
    menu([`Delete ${name}`], 0, () => {
      haptics.warning();
      remove.mutate(element.id);
    });

  if (element.type === "component") {
    switch (element.componentType) {
      case "todo-list": {
        const data = todoListDataSchema.safeParse(element.data);
        return data.success ? (
          <TodoList
            elementId={element.id}
            title={data.data.title}
            items={data.data.items}
            onLongPressTitle={() => askRemove("list")}
          />
        ) : null;
      }
      case "quick-links": {
        const data = quickLinksDataSchema.safeParse(element.data);
        return data.success ? (
          <QuickLinks
            elementId={element.id}
            title={data.data.title}
            links={data.data.links}
            onLongPressTitle={() => askRemove("links")}
          />
        ) : null;
      }
      case "sticky-note":
      case "markdown-note": {
        const schema =
          element.componentType === "sticky-note"
            ? stickyNoteDataSchema
            : markdownNoteDataSchema;
        const data = schema.safeParse(element.data);
        if (!data.success) return null;
        return (
          <Row
            title={data.data.content.trim().split("\n")[0] || "Note"}
            subtitle={
              data.data.content.trim().split("\n").slice(1).join(" ") ||
              undefined
            }
            chevron
            onPress={() => router.push(`/board-note?id=${element.id}`)}
            onLongPress={() => askRemove("note")}
          />
        );
      }
      case "pdf-viewer": {
        const data = pdfViewerDataSchema.safeParse(element.data);
        const url = data.success ? data.data.pdfUrl : undefined;
        return url ? (
          <Row
            title={(data.success && data.data.fileName) || "PDF"}
            chevron
            onPress={() => openUrl(url)}
          />
        ) : null;
      }
      default:
        return null;
    }
  }
  if (whiteboardElementKind(element) === "image") {
    const data = imageDataSchema.safeParse(element.data);
    return data.success ? (
      <Row title="Image" chevron onPress={() => openUrl(data.data.src)} />
    ) : null;
  }
  return null;
}

function TodoList({
  elementId,
  title,
  items,
  onLongPressTitle,
}: {
  elementId: string;
  title?: string;
  items: { id: string; text: string; completed: boolean }[];
  onLongPressTitle: () => void;
}) {
  const edit = useBoardItems();
  const [draft, setDraft] = useState("");

  const move = (index: number, to: number) => {
    const item = items[index];
    if (!item) return;
    haptics.selection();
    edit.mutate({
      elementId,
      ops: {
        remove: [item.id],
        add: [{ text: item.text, completed: item.completed }],
        insertAt: to,
      },
    });
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    haptics.light();
    edit.mutate({ elementId, ops: { add: [{ text }] } });
  };

  return (
    <View>
      <Pressable onLongPress={onLongPressTitle}>
        <Text variant="footnote" tone="secondary" style={styles.listTitle}>
          {title || "Todo"}
        </Text>
      </Pressable>
      {edit.error ? <Notice message={edit.error.message} /> : null}
      {items.map((item, index) => (
        <View key={item.id}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.completed }}
            onPress={() => {
              haptics.selection();
              edit.mutate({
                elementId,
                ops: { update: [{ id: item.id, completed: !item.completed }] },
              });
            }}
            onLongPress={() =>
              menu(["Move up", "Move down", "Delete"], 2, (choice) => {
                if (choice === 0 && index > 0) move(index, index - 1);
                else if (choice === 1 && index < items.length - 1)
                  move(index, index + 1);
                else if (choice === 2) {
                  haptics.warning();
                  edit.mutate({ elementId, ops: { remove: [item.id] } });
                }
              })
            }
            style={({ pressed }) => [styles.todo, pressed && { opacity: 0.55 }]}
          >
            <SymbolView
              name={item.completed ? "checkmark.circle.fill" : "circle"}
              size={20}
              tintColor={item.completed ? colors.tertiaryLabel : colors.label}
            />
            <Text
              tone={item.completed ? "tertiary" : "primary"}
              style={[
                styles.todoText,
                item.completed && { textDecorationLine: "line-through" },
              ]}
            >
              {item.text}
            </Text>
          </Pressable>
          <Hairline />
        </View>
      ))}
      <View style={styles.todo}>
        <SymbolView name="plus" size={20} tintColor={colors.tertiaryLabel} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          submitBehavior="submit"
          returnKeyType="done"
          placeholder="Add"
          placeholderTextColor={colors.placeholder}
          style={[typeScale.body, styles.todoText, { color: colors.label }]}
        />
      </View>
    </View>
  );
}

function QuickLinks({
  elementId,
  title,
  links,
  onLongPressTitle,
}: {
  elementId: string;
  title: string;
  links: { id: string; label: string; url: string }[];
  onLongPressTitle: () => void;
}) {
  const edit = useBoardItems();
  const addLink = () =>
    Alert.prompt("Add link", undefined, (value) => {
      const url = value.trim();
      if (!url) return;
      const full = /^https?:\/\//.test(url) ? url : `https://${url}`;
      let label = full;
      try {
        label = new URL(full).hostname.replace(/^www\./, "");
      } catch {}
      edit.mutate({ elementId, ops: { add: [{ label, url: full }] } });
    });
  return (
    <View>
      <Pressable onLongPress={onLongPressTitle} style={styles.linksHeader}>
        <Text variant="footnote" tone="secondary" style={styles.listTitle}>
          {title}
        </Text>
        <Pressable hitSlop={10} onPress={addLink}>
          <SymbolView name="plus" size={14} tintColor={colors.secondaryLabel} />
        </Pressable>
      </Pressable>
      {edit.error ? <Notice message={edit.error.message} /> : null}
      {links.map((link) => (
        <Row
          key={link.id}
          title={link.label}
          subtitle={link.url}
          chevron
          onPress={() => openUrl(link.url)}
          onLongPress={() =>
            menu(["Remove"], 0, () =>
              edit.mutate({ elementId, ops: { remove: [link.id] } }),
            )
          }
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  picture: {
    width: "100%",
    maxHeight: 420,
    marginVertical: spacing.sm,
    borderRadius: 6,
  },
  components: { gap: spacing.lg },
  listTitle: { paddingVertical: spacing.xs },
  linksHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  todo: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 46,
  },
  todoText: { flex: 1, paddingVertical: spacing.sm },
  clear: { alignSelf: "flex-start", marginTop: spacing.md },
});
