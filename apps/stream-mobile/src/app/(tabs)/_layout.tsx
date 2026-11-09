import { NativeTabs } from "expo-router/unstable-native-tabs";
import { colors } from "@/ui";

/** Home · New & Popular · My Stream. `sf` names the iOS glyph, `md` the Material one. */
export default function TabsLayout() {
  return (
    <NativeTabs
      tintColor={colors.paper}
      iconColor={colors.muted}
      backgroundColor={colors.ink}
      indicatorColor={colors.fill}
    >
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Icon
          sf={{ default: "house", selected: "house.fill" }}
          md="home"
        />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="new">
        <NativeTabs.Trigger.Icon
          sf={{
            default: "play.rectangle.on.rectangle",
            selected: "play.rectangle.on.rectangle.fill",
          }}
          md="video_library"
        />
        <NativeTabs.Trigger.Label>New & Popular</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="my">
        <NativeTabs.Trigger.Icon
          sf={{
            default: "person.crop.square",
            selected: "person.crop.square.fill",
          }}
          md="account_box"
        />
        <NativeTabs.Trigger.Label>My Stream</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
