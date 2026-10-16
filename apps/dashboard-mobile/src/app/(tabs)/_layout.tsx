import { colors } from "@repo/native-ui";
import { NativeTabs } from "expo-router/unstable-native-tabs";

export default function TabsLayout() {
  return (
    <NativeTabs tintColor={colors.tint} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="today">
        <NativeTabs.Trigger.Icon
          sf={{ default: "sun.max", selected: "sun.max.fill" }}
        />
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Icon
          sf={{ default: "tray", selected: "tray.fill" }}
        />
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Icon sf="calendar" />
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="money">
        <NativeTabs.Trigger.Icon
          sf={{ default: "banknote", selected: "banknote.fill" }}
        />
        <NativeTabs.Trigger.Label>Money</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Icon sf="ellipsis" />
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
