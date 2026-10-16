import { DatePicker, Host } from "@expo/ui/swift-ui";
import { datePickerStyle, labelsHidden } from "@expo/ui/swift-ui/modifiers";
import type { StyleProp, ViewStyle } from "react-native";

/** SwiftUI's compact pill, sized to its content so it can sit at a row's end. */
export function CompactPicker({
  value,
  onChange,
  mode = "time",
  maximum,
  style,
}: {
  value: Date;
  onChange: (date: Date) => void;
  mode?: "time" | "date";
  maximum?: Date;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Host matchContents style={style}>
      <DatePicker
        selection={value}
        displayedComponents={[mode === "time" ? "hourAndMinute" : "date"]}
        range={maximum ? { end: maximum } : undefined}
        onDateChange={onChange}
        modifiers={[datePickerStyle("compact"), labelsHidden()]}
      />
    </Host>
  );
}

/** The wheel, for the one time a sheet is about. */
export function WheelTimePicker({
  value,
  onChange,
}: {
  value: Date;
  onChange: (date: Date) => void;
}) {
  return (
    <Host matchContents>
      <DatePicker
        selection={value}
        displayedComponents={["hourAndMinute"]}
        onDateChange={onChange}
        modifiers={[datePickerStyle("wheel"), labelsHidden()]}
      />
    </Host>
  );
}
