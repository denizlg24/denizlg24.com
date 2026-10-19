import { DatePicker, Host } from "@expo/ui/swift-ui";
import {
  datePickerStyle,
  labelsHidden,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { StyleProp, ViewStyle } from "react-native";

// The SwiftUI picker, drawn inline. Android draws a field that opens the
// system dialogs instead (date-time-picker.android.tsx): its community picker
// opens a dialog the moment it mounts.
export {
  DateTimePicker,
  type DateTimePickerProps,
} from "@expo/ui/community/datetime-picker";

export interface CompactTimePickerProps {
  value: Date;
  onValueChange: (date: Date) => void;
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The compact time pill, sized to its content. The community picker only
 * sizes itself vertically, so in a row it stretches and centres the pill;
 * this one can sit at the trailing edge like a Settings row.
 */
export interface CompactDatePickerProps {
  value: Date;
  onValueChange: (date: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  style?: StyleProp<ViewStyle>;
}

/**
 * The compact date pill. Its calendar opens in a popover that dismisses
 * itself once a day is picked, which an inline wheel never does.
 */
export function CompactDatePicker({
  value,
  onValueChange,
  minimumDate,
  maximumDate,
  style,
}: CompactDatePickerProps) {
  return (
    <Host matchContents style={style}>
      <DatePicker
        selection={value}
        range={{ start: minimumDate, end: maximumDate }}
        displayedComponents={["date"]}
        onDateChange={onValueChange}
        modifiers={[datePickerStyle("compact"), labelsHidden()]}
      />
    </Host>
  );
}

export function CompactTimePicker({
  value,
  onValueChange,
  accentColor,
  style,
}: CompactTimePickerProps) {
  return (
    <Host matchContents style={style}>
      <DatePicker
        selection={value}
        displayedComponents={["hourAndMinute"]}
        onDateChange={onValueChange}
        modifiers={[
          datePickerStyle("compact"),
          labelsHidden(),
          ...(accentColor ? [tint(accentColor)] : []),
        ]}
      />
    </Host>
  );
}
