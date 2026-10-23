import { VideoAirPlayButton } from "expo-video";
import { StyleSheet } from "react-native";
import { colors } from "@/ui";

/** AVRoutePickerView: the system's own AirPlay button and device picker. */
export function AirPlayButton({ disabled }: { disabled: boolean }) {
  if (disabled) return null;
  return (
    <VideoAirPlayButton
      tint={colors.paper}
      activeTint={colors.amber}
      prioritizeVideoDevices
      style={styles.button}
      accessibilityLabel="AirPlay"
    />
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44 },
});
