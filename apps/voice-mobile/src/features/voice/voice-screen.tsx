import { router } from "expo-router";
import { StyleSheet, Text, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VoiceOrb } from "./orb";
import { useVoice } from "./voice-controller";

export function VoiceScreen() {
  const voice = useVoice();
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === "dark";
  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: dark ? "#000000" : "#f9f8f6",
          paddingBottom: insets.bottom + 32,
        },
      ]}
    >
      <VoiceOrb
        state={voice.state}
        level={voice.level}
        pulse={voice.pulse}
        onPress={() => {
          if (
            voice.state === "idle" ||
            voice.state === "error" ||
            voice.state === "responding"
          ) {
            void voice.start();
          } else {
            voice.stop();
          }
        }}
        onLongPress={() => router.push("/conversation")}
      />
      <Text
        numberOfLines={2}
        style={[
          styles.ticker,
          { color: dark ? "rgba(235,235,245,0.6)" : "rgba(60,60,67,0.6)" },
        ]}
      >
        {voice.ticker || " "}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 24,
  },
  ticker: { fontSize: 15, lineHeight: 20, textAlign: "center", minHeight: 40 },
});
