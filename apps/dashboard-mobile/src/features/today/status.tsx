import { colors, type TextTone } from "@repo/native-ui";
import { View } from "react-native";

export type HealthStatus = "healthy" | "degraded" | "unreachable" | null;

const dotColor = {
  healthy: colors.working,
  degraded: colors.onBreak,
  unreachable: colors.destructive,
} as const;

export function StatusDot({ status }: { status: HealthStatus }) {
  return (
    <View
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: status ? dotColor[status] : colors.tertiaryLabel,
      }}
    />
  );
}

export function severityTone(
  severity: "info" | "warning" | "critical",
): TextTone {
  return severity === "critical"
    ? "destructive"
    : severity === "warning"
      ? "onBreak"
      : "secondary";
}
