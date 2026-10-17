import {
  colors,
  HeaderButton,
  Notice,
  Row,
  spacing,
  typeScale,
} from "@repo/native-ui";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import {
  createConversation,
  useConversations,
  useDefaultModel,
} from "@/api/agent";
import { KeyboardDock } from "@/features/shell/keyboard-dock";
import { QueryState } from "@/features/shell/tab-page";
import { ago } from "@/lib/format";

/** Conversations, newest first, and the line that starts a new one. */
export default function ChatHome() {
  const router = useRouter();
  const conversations = useConversations();
  const model = useDefaultModel();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const start = async () => {
    const text = draft.trim();
    if (!text || !model.data || starting) return;
    setStarting(true);
    setError(null);
    try {
      const id = await createConversation(text, model.data);
      setDraft("");
      router.push({ pathname: "/chat/[id]", params: { id, first: text } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start");
    } finally {
      setStarting(false);
    }
  };

  return (
    <KeyboardDock>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <HeaderButton
              symbol="xmark"
              label="Close"
              onPress={() => router.back()}
            />
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
      >
        <QueryState error={conversations.error} loading={!conversations.data} />
        {conversations.data?.conversations.map((item, index, rows) => (
          <Row
            key={item._id}
            title={item.title}
            value={ago(item.updatedAt)}
            separator={index < rows.length - 1}
            onPress={() => router.push(`/chat/${item._id}`)}
          />
        ))}
      </ScrollView>
      {error ? <Notice message={error} /> : null}
      {model.error ? <Notice message={model.error.message} /> : null}
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => void start()}
          submitBehavior="submit"
          returnKeyType="send"
          editable={!starting}
          placeholder="New conversation"
          placeholderTextColor={colors.placeholder}
          style={[typeScale.body, styles.input, { color: colors.label }]}
        />
      </View>
    </KeyboardDock>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  composer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  input: { paddingVertical: spacing.xs },
});
