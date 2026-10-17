import { colors, Notice, spacing, typeScale } from "@repo/native-ui";
import { markdownNoteDataSchema, stickyNoteDataSchema } from "@repo/schemas";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Button, StyleSheet, TextInput, View } from "react-native";
import { useBoard, usePatchBoardElement } from "@/api/board";
import { KeyboardDock } from "@/features/shell/keyboard-dock";

/** A sticky or Markdown note's text; `data` is shallow-merged on the server. */
export default function BoardNote() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const board = useBoard();
  const patch = usePatchBoardElement();
  const element = board.data?.elements.find((item) => item.id === id);
  const parsed = (
    element?.componentType === "markdown-note"
      ? markdownNoteDataSchema
      : stickyNoteDataSchema
  ).safeParse(element?.data);
  const original = parsed.success ? parsed.data.content : "";
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    if (content === null && element) setContent(original);
  }, [content, element, original]);

  const save = () => {
    if (!id || content === null || content === original) {
      router.back();
      return;
    }
    patch.mutate(
      { elementId: id, patch: { data: { content } } },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <KeyboardDock>
      <View style={styles.screen}>
        <Stack.Screen
          options={{
            title:
              element?.componentType === "markdown-note" ? "Note" : "Sticky",
            headerRight: () => (
              <Button title="Done" disabled={patch.isPending} onPress={save} />
            ),
          }}
        />
        {patch.error ? <Notice message={patch.error.message} /> : null}
        <TextInput
          value={content ?? ""}
          onChangeText={setContent}
          multiline
          autoFocus
          placeholderTextColor={colors.placeholder}
          style={[typeScale.body, styles.input, { color: colors.label }]}
        />
      </View>
    </KeyboardDock>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg },
  input: { flex: 1, textAlignVertical: "top" },
});
