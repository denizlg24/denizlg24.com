import { NativeTabs } from "expo-router/unstable-native-tabs";
import { colors } from "@/ui";

/** UITabBar: Liquid Glass on iOS 26, minimised while scrolling. */
export default function TabsLayout() {
  return (
    <NativeTabs tintColor={colors.tint} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: "clock", selected: "clock.fill" }}
        />
        <NativeTabs.Trigger.Label>Clock</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Icon sf="list.bullet" />
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="pay">
        <NativeTabs.Trigger.Icon
          sf={{ default: "banknote", selected: "banknote.fill" }}
        />
        <NativeTabs.Trigger.Label>Pay</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
