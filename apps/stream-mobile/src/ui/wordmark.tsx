import { Play } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Text } from "./text";
import { colors, fonts } from "./theme";

/** STREAM in Big Shoulders Black, after a small filled amber play triangle. */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    // The label sits on the text: an `accessible` View is a stop for a TV
    // remote's focus on Android, and the wordmark has nothing to press.
    <View style={styles.row}>
      <Play
        size={size * 0.62}
        color={colors.amber}
        fill={colors.amber}
        strokeWidth={1.5}
      />
      <Text
        accessibilityRole="header"
        accessibilityLabel="Stream"
        style={{
          fontFamily: fonts.display,
          fontSize: size,
          lineHeight: Math.round(size * 0.92),
        }}
      >
        STREAM
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
});
