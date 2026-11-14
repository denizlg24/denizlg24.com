import {
  colors,
  haptics,
  Notice,
  Row,
  spacing,
  Text,
  typeScale,
} from "@repo/native-ui";
import type { Block } from "@repo/schemas";
import { randomUUID } from "expo-crypto";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Button, ScrollView, StyleSheet, TextInput } from "react-native";
import {
  useCreateWorkspacePage,
  useWorkspaceOps,
  useWorkspacePage,
} from "@/api/workspace";
import { QueryState } from "@/features/shell/tab-page";

function paragraph(text: string): Block {
  return {
    id: randomUUID(),
    type: "paragraph",
    text: [{ type: "text", text }],
  };
}

export function NewWorkspacePageScreen({ parentId }: { parentId?: string }) {
  const router = useRouter();
  const create = useCreateWorkspacePage();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const save = () => {
    if (!title.trim() || create.isPending) return;
    create.mutate(
      {
        title: title.trim(),
        parentId: parentId ?? null,
        blocks: text.trim() ? [paragraph(text.trim())] : [],
      },
      {
        onSuccess: (page) => {
          haptics.success();
          router.back();
          router.push({ pathname: "/more/page/[id]", params: { id: page.id } });
        },
      },
    );
  };
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: "New page",
          headerLeft: () => (
            <Button
              title="Cancel"
              onPress={() => router.back()}
              disabled={create.isPending}
            />
          ),
          headerRight: () => (
            <Button
              title={create.isPending ? "Creating…" : "Create"}
              disabled={!title.trim() || create.isPending}
              onPress={save}
            />
          ),
          gestureEnabled: !create.isPending,
        }}
      />
      {create.error ? <Notice message={create.error.message} /> : null}
      <TextInput
        accessibilityLabel="Page title"
        placeholder="Page title"
        value={title}
        onChangeText={setTitle}
        autoFocus
        maxLength={500}
        placeholderTextColor={colors.secondaryLabel}
        style={[typeScale.title3, styles.input]}
      />
      <TextInput
        accessibilityLabel="Page text"
        placeholder="Start writing (optional)"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={20000}
        placeholderTextColor={colors.secondaryLabel}
        style={[typeScale.body, styles.body, styles.input]}
      />
    </ScrollView>
  );
}

export function WorkspaceCaptureScreen({ id }: { id: string }) {
  const router = useRouter();
  const page = useWorkspacePage(id);
  const ops = useWorkspaceOps(id);
  const [text, setText] = useState("");
  const canSave =
    !!text.trim() &&
    !!page.data &&
    !page.data.locked &&
    !page.data.deletedAt &&
    !ops.isPending &&
    !page.isRefetching;
  const save = () => {
    if (!canSave || !page.data) return;
    ops.mutate(
      {
        baseRev: page.data.rev,
        ops: [
          {
            op: "insert",
            block: paragraph(text.trim()),
            parentId: null,
            after: page.data.blocks.at(-1)?.id ?? null,
          },
        ],
      },
      {
        onSuccess: () => {
          haptics.success();
          router.back();
        },
      },
    );
  };
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: "Add to page",
          headerLeft: () => (
            <Button
              title="Cancel"
              disabled={ops.isPending}
              onPress={() => router.back()}
            />
          ),
          headerRight: () => (
            <Button
              title={ops.isPending ? "Saving…" : "Save"}
              disabled={!canSave}
              onPress={save}
            />
          ),
          gestureEnabled: !ops.isPending,
        }}
      />
      <QueryState error={page.error} loading={page.isPending} />
      {page.error ? (
        <Row title="Try again" onPress={() => void page.refetch()} />
      ) : null}
      {page.data?.locked || page.data?.deletedAt ? (
        <Notice message="This page is locked or in the trash. Open it on web to continue." />
      ) : null}
      {ops.error ? (
        <Notice
          message={`${ops.error.message}. Your text is still here. Refresh and try again.`}
        />
      ) : null}
      {page.data ? (
        <Text variant="footnote" tone="secondary">
          Adding to {page.data.title || "Untitled"}
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel="Text to add"
        placeholder="Capture a thought…"
        value={text}
        onChangeText={setText}
        multiline
        autoFocus
        maxLength={20000}
        placeholderTextColor={colors.secondaryLabel}
        style={[typeScale.body, styles.body, styles.input]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  input: { color: colors.label, minHeight: 48 },
  body: { minHeight: 200, textAlignVertical: "top" },
});
