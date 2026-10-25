import { Host, Stepper as SwiftStepper } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  disabled as disabledModifier,
  labelsHidden,
} from "@expo/ui/swift-ui/modifiers";
import type { StyleProp, ViewStyle } from "react-native";

export interface StepperProps {
  /** Shown beside the buttons, or only read by VoiceOver when `hideLabel`. */
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onValueChange: (value: number) => void;
  hideLabel?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** SwiftUI's stepper. Android draws its own (stepper.android.tsx). */
export function Stepper({
  label,
  hideLabel = false,
  disabled = false,
  style,
  ...props
}: StepperProps) {
  // `labelsHidden()` alone still draws the label here, and a long one widens
  // the host until the buttons leave the row, so VoiceOver gets it instead.
  const modifiers = [
    ...(hideLabel ? [labelsHidden(), accessibilityLabel(label)] : []),
    ...(disabled ? [disabledModifier(true)] : []),
  ];
  return (
    <Host matchContents={hideLabel ? true : { vertical: true }} style={style}>
      <SwiftStepper
        {...props}
        label={hideLabel ? "" : label}
        modifiers={modifiers.length > 0 ? modifiers : undefined}
      />
    </Host>
  );
}
