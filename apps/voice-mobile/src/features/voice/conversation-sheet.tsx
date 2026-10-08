import { router } from "expo-router";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { auth } from "@/lib/auth";
import { haptics } from "@/lib/haptics";
import { useVoice } from "./voice-controller";

/** This session's turns, newest last, with the two things a session needs. */
export function ConversationSheet() {
  const voice = useVoice();
  const dark = useColorScheme() === "dark";
  const label = dark ? "#ffffff" : "#000000";
  const secondary = dark ? "rgba(235,235,245,0.6)" : "rgba(60,60,67,0.6)";
  const separator = dark ? "rgba(84,84,88,0.65)" : "rgba(60,60,67,0.29)";
  return (
    <ScrollView
      style={{ backgroundColor: dark ? "#1c1c1e" : "#ffffff" }}
      contentContainerStyle={styles.content}
    >
      {voice.exchanges.map((exchange) => (
        <View
          key={exchange.id}
          style={[styles.turn, { borderBottomColor: separator }]}
        >
          <Text style={[styles.question, { color: label }]}>
            {exchange.question}
          </Text>
          <Text style={[styles.reply, { color: secondary }]}>
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
        <Text style={[styles.actionText, { color: label }]}>
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
        <Text
          style={[styles.actionText, { color: dark ? "#ff453a" : "#ff3b30" }]}
        >
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
  },
  question: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  reply: { fontSize: 15, lineHeight: 21 },
  action: { minHeight: 48, justifyContent: "center" },
  actionText: { fontSize: 17, fontWeight: "600" },
});
