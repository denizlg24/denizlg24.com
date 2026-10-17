import { colors, haptics, Text } from "@repo/native-ui";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { auth } from "@/lib/auth";
import { useVoice } from "./voice-controller";

/** This session's turns, newest last, with the two things a session needs. */
export function ConversationSheet() {
  const voice = useVoice();
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      {voice.exchanges.map((exchange) => (
        <View key={exchange.id} style={styles.turn}>
          <Text variant="headline">{exchange.question}</Text>
          <Text variant="callout" tone="secondary">
            {exchange.reply}
          </Text>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          voice.newConversation();
          router.back();
        }}
        style={styles.action}
      >
        <Text variant="body" weight="semibold">
          New conversation
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          haptics.warning();
          voice.stop();
          router.back();
          void auth.signOut();
        }}
        style={styles.action}
      >
        <Text variant="body" weight="semibold" tone="destructive">
          Sign out
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 28, gap: 4 },
  turn: {
    paddingVertical: 14,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  action: { minHeight: 48, justifyContent: "center" },
});
