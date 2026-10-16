import {
  colors,
  Field,
  haptics,
  Notice,
  spacing,
  typeScale,
} from "@repo/native-ui";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Button, ScrollView, StyleSheet, TextInput } from "react-native";
import { useEmail, useSendEmail } from "@/api/inbox";
import { quoteOriginal, replySubject } from "@/features/inbox/email-html";

/** A new message or a reply; sent at once through the account's SMTP. */
export default function Compose() {
  const { accountId, replyTo } = useLocalSearchParams<{
    accountId: string;
    replyTo?: string;
  }>();
  const router = useRouter();
  const send = useSendEmail(accountId);
  const original = useEmail(accountId, replyTo ?? "");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [prefilled, setPrefilled] = useState(!replyTo);

  useEffect(() => {
    if (prefilled || !original.data) return;
    const sender = original.data.from[0];
    setTo(sender?.address ?? "");
    setSubject(replySubject(original.data.subject));
    setBody(
      quoteOriginal(
        original.data.textBody ?? "",
        sender?.name || sender?.address || "",
        original.data.date,
      ),
    );
    setPrefilled(true);
  }, [original.data, prefilled]);

  const recipients = to
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const ready = recipients.length > 0 && body.trim().length > 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: replyTo ? "Reply" : "New message",
          headerLeft: () => (
            <Button title="Cancel" onPress={() => router.back()} />
          ),
          headerRight: () => (
            <Button
              title="Send"
              disabled={!ready || send.isPending}
              onPress={() =>
                send.mutate(
                  {
                    to: recipients,
                    subject,
                    text: body,
                    ...(original.data?.messageId
                      ? { replyToMessageId: original.data.messageId }
                      : {}),
                  },
                  {
                    onSuccess: () => {
                      haptics.success();
                      router.back();
                    },
                  },
                )
              }
            />
          ),
        }}
      />
      {send.error ? <Notice message={send.error.message} /> : null}
      <Field
        label="To"
        value={to}
        onChangeText={setTo}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoFocus={!replyTo}
      />
      <Field label="Subject" value={subject} onChangeText={setSubject} />
      <TextInput
        value={body}
        onChangeText={setBody}
        multiline
        autoFocus={Boolean(replyTo)}
        placeholderTextColor={colors.placeholder}
        style={[typeScale.body, styles.body, { color: colors.label }]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.xs },
  body: { minHeight: 280, paddingTop: spacing.md, textAlignVertical: "top" },
});
