import {
  colors,
  HeaderButton,
  haptics,
  Notice,
  Row,
  Screen,
  spacing,
  Text,
  typeScale,
} from "@repo/native-ui";
import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Button, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useCreateNote, useNote, useNotes } from "@/api/more";
import { Dash, QueryState } from "@/features/shell/tab-page";
import { ago } from "@/lib/format";

export function NotesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const notes = useNotes(query);
  return (
    <Screen
      onRefresh={() => void notes.refetch()}
      refreshing={notes.isRefetching}
    >
      <Stack.Screen
        options={{
          title: "Notes",
          headerRight: () => (
            <HeaderButton
              symbol="square.and.pencil"
              label="New note"
              onPress={() => router.push("/note-new")}
            />
          ),
        }}
      />
      <TextInput
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={() => setQuery(search.trim())}
        returnKeyType="search"
        clearButtonMode="while-editing"
        placeholder="Search"
        placeholderTextColor={colors.placeholder}
        style={[typeScale.body, styles.search, { color: colors.label }]}
      />
      <QueryState error={notes.error} loading={!notes.data} />
      {notes.data?.length === 0 ? <Dash /> : null}
      {notes.data?.map((note, index, rows) => (
        <Row
          key={note._id}
          title={note.title}
          subtitle={note.preview.trim().split("\n")[0] || note.url}
          value={ago(note.updatedAt)}
          separator={index < rows.length - 1}
          onPress={() => router.push(`/more/note/${note._id}`)}
        />
      ))}
    </Screen>
  );
}

/** Read only; editing a note is a keyboard job. */
export function NoteScreen({ id }: { id: string }) {
  const note = useNote(id);
  const data = note.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: "" }} />
      <QueryState error={note.error} loading={!data} />
      {data ? (
        <View style={{ gap: spacing.md }}>
          <Text variant="title2" selectable>
            {data.title}
          </Text>
          {data.url ? (
            <Text
              variant="footnote"
              weight="semibold"
              numberOfLines={1}
              onPress={() =>
                data.url && void WebBrowser.openBrowserAsync(data.url)
              }
            >
              {data.url}
            </Text>
          ) : null}
          {data.tags.length > 0 ? (
            <Text variant="footnote" tone="secondary">
              {data.tags.join(" · ")}
            </Text>
          ) : null}
          <Text variant="body" selectable>
            {data.content || data.description || "—"}
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

/** Capture: a line of text, or a link whose title the server reads. */
export function NewNoteScreen() {
  const router = useRouter();
  const create = useCreateNote();
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const url = /^https?:\/\/\S+$/.test(trimmed) ? trimmed : undefined;
  const save = () => {
    if (!trimmed) return;
    const title = (trimmed.split("\n")[0] ?? trimmed).slice(0, 120);
    create.mutate(
      url ? { title: "", content: "", url } : { title, content: trimmed },
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
      style={styles.sheet}
      contentContainerStyle={{ padding: spacing.lg }}
    >
      <Stack.Screen
        options={{
          title: "Note",
          headerRight: () => (
            <Button
              title="Save"
              disabled={!trimmed || create.isPending}
              onPress={save}
            />
          ),
        }}
      />
      {create.error ? <Notice message={create.error.message} /> : null}
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        autoFocus
        placeholderTextColor={colors.placeholder}
        style={[typeScale.body, styles.body, { color: colors.label }]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  search: { paddingVertical: spacing.sm, marginBottom: spacing.xs },
  sheet: { flex: 1, backgroundColor: colors.background },
  body: { minHeight: 200, textAlignVertical: "top" },
});
