import { router } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { haptics } from "@/lib/haptics";
import { colors } from "@/ui";
import { tabGlyphs } from "@/ui/glyphs";

/**
 * UITabBar via react-native-screens: Liquid Glass on iOS 26, the system bar
 * before it. The "+" in the middle is a disabled trigger, so a tap opens the
 * shortcuts sheet instead of ever selecting its empty screen. Icons are the
 * web app's Lucide set, as template images the bar tints.
 */
export default function TabsLayout() {
  return (
    <NativeTabs tintColor={colors.tint} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(today)">
        <NativeTabs.Trigger.Icon
          src={tabGlyphs.layoutTemplate}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="log">
        <NativeTabs.Trigger.Icon
          src={tabGlyphs.apple}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>Log</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="add"
        disabled
        accessibilityLabel="Add"
        listeners={{
          tabPress: () => {
            haptics.selection();
            router.push("/shortcuts");
          },
        }}
      >
        <NativeTabs.Trigger.Icon
          src={tabGlyphs.circlePlus}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>Add</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="progress">
        <NativeTabs.Trigger.Icon
          src={tabGlyphs.chartLine}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>Progress</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Icon
          src={tabGlyphs.circleEllipsis}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
