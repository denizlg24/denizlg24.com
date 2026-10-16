import {
  Button,
  colors,
  Stack as Gap,
  haptics,
  Notice,
  Row,
  Screen,
  Section,
  spacing,
  Text,
  typeScale,
} from "@repo/native-ui";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useContacts, useReplyContact, useUpdateContact } from "@/api/inbox";
import { QueryState } from "@/features/shell/tab-page";
import { ago } from "@/lib/format";

export function ContactDetail({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const contacts = useContacts();
  const update = useUpdateContact();
  const reply = useReplyContact();
  const [message, setMessage] = useState("");
  const contact = contacts.data?.contacts.find(
    (item) => item.ticketId === ticketId,
  );

  // Opening a new ticket is reading it.
  const status = contact?.status;
  const { mutate } = update;
  useEffect(() => {
    if (status === "pending") mutate({ ticketId, status: "read" });
  }, [status, ticketId, mutate]);

  return (
    <Screen>
      <Stack.Screen options={{ title: contact?.name ?? "" }} />
      <QueryState error={contacts.error} loading={!contacts.data} />
      {update.error ? <Notice message={update.error.message} /> : null}
      {contact ? (
        <Gap>
          <View style={styles.head}>
            <Text variant="subheadline" tone="secondary" selectable>
              {contact.email} · {ago(contact.createdAt)}
            </Text>
            <Text variant="body" selectable>
              {contact.message}
            </Text>
          </View>

          <Section title="Reply">
            {reply.error ? <Notice message={reply.error.message} /> : null}
            <TextInput
              value={message}
              onChangeText={setMessage}
              multiline
              placeholderTextColor={colors.placeholder}
              style={[typeScale.body, styles.reply, { color: colors.label }]}
            />
            <Button
              label="Send"
              disabled={!message.trim()}
              loading={reply.isPending}
              onPress={() =>
                reply.mutate(
                  { ticketId, message: message.trim() },
                  {
                    onSuccess: () => {
                      haptics.success();
                      setMessage("");
                    },
                  },
                )
              }
            />
          </Section>

          <Section title="Status">
            {(["read", "responded", "archived"] as const).map((next, index) => (
              <Row
                key={next}
                title={next[0]?.toUpperCase() + next.slice(1)}
                value={contact.status === next ? "✓" : undefined}
                separator={index < 2}
                onPress={() => {
                  haptics.selection();
                  update.mutate(
                    { ticketId, status: next },
                    {
                      onSuccess: () => {
                        if (next === "archived") router.back();
                      },
                    },
                  );
                }}
              />
            ))}
          </Section>
        </Gap>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: spacing.sm },
  reply: {
    minHeight: 120,
    textAlignVertical: "top",
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
});
