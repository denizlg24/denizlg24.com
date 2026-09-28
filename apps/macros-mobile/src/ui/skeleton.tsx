import { View, type ViewStyle } from "react-native";
import { colors, radius as radii } from "./theme";

export interface SkeletonProps {
  width: ViewStyle["width"];
  height: ViewStyle["height"];
  radius?: number;
  style?: ViewStyle;
}

/**
 * The resting shape of something still loading, drawn at its final size so
 * nothing moves when it arrives.
 */
export function Skeleton({
  width,
  height,
  radius = radii.sm,
  style,
}: SkeletonProps) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: colors.tertiaryFill,
        },
        style,
      ]}
    />
  );
}
