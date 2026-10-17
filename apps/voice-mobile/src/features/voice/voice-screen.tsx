import { colors, Text } from "@repo/native-ui";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VoiceOrb } from "./orb";
import { useVoice } from "./voice-controller";

export function VoiceScreen() {
  const voice = useVoice();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
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
        variant="subheadline"
        tone="secondary"
        align="center"
        numberOfLines={2}
        style={styles.ticker}
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
  ticker: { minHeight: 40 },
});
