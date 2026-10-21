import { Host, Stepper as SwiftStepper } from "@expo/ui/swift-ui";
import {
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
  hideLabel = false,
  disabled = false,
  style,
  ...props
}: StepperProps) {
  const modifiers = [
    ...(hideLabel ? [labelsHidden()] : []),
    ...(disabled ? [disabledModifier(true)] : []),
  ];
  return (
    <Host matchContents={hideLabel ? true : { vertical: true }} style={style}>
      <SwiftStepper
        {...props}
        modifiers={modifiers.length > 0 ? modifiers : undefined}
      />
    </Host>
  );
}
