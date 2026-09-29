import {
  Host,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Text,
} from "@expo/ui/jetpack-compose";
import type * as Shared from "./segmented-control";
import { useResolvedColors } from "./theme";

export type { SegmentedControlProps } from "./segmented-control";

export const SegmentedControl: typeof Shared.SegmentedControl = ({
  values = [],
  selectedIndex,
  enabled = true,
  onChange,
  onValueChange,
  appearance,
  style,
}) => {
  const resolved = useResolvedColors();
  const buttonColors = {
    activeContainerColor: resolved.label,
    activeContentColor: resolved.background,
    activeBorderColor: resolved.label,
    inactiveContainerColor: resolved.background,
    inactiveContentColor: resolved.label,
    inactiveBorderColor: resolved.separator,
    disabledActiveContainerColor: resolved.fill,
    disabledActiveContentColor: resolved.secondaryLabel,
    disabledActiveBorderColor: resolved.separator,
    disabledInactiveContainerColor: resolved.background,
    disabledInactiveContentColor: resolved.tertiaryLabel,
    disabledInactiveBorderColor: resolved.separator,
  };

  return (
    <Host
      matchContents={{ vertical: true }}
      style={style}
      colorScheme={appearance}
    >
      <SingleChoiceSegmentedButtonRow>
        {values.map((label, index) => (
          <SegmentedButton
            key={label}
            selected={index === selectedIndex}
            enabled={enabled}
            colors={buttonColors}
            onClick={() => {
              onValueChange?.(label);
              onChange?.({
                nativeEvent: { selectedSegmentIndex: index, value: label },
              });
            }}
          >
            <SegmentedButton.Label>
              <Text>{label}</Text>
            </SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
};
