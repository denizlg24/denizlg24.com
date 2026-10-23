import { NativeTabs } from "expo-router/unstable-native-tabs";
import { colors } from "@/ui";

/** Studio: Tonight · Tune · Map · Shelf. `sf` names the iOS glyph, `md` the Material one. */
export default function StudioLayout() {
  return (
    <NativeTabs
      tintColor={colors.amber}
      iconColor={colors.muted}
      backgroundColor={colors.ink}
      indicatorColor={colors.fill}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="tonight">
        <NativeTabs.Trigger.Icon sf="sparkles.tv" md="live_tv" />
        <NativeTabs.Trigger.Label>Tonight</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tune">
        <NativeTabs.Trigger.Icon sf="dial.medium" md="tune" />
        <NativeTabs.Trigger.Label>Tune</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="map">
        <NativeTabs.Trigger.Icon
          sf={{ default: "map", selected: "map.fill" }}
          md="map"
        />
        <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="shelf">
        <NativeTabs.Trigger.Icon sf="books.vertical" md="video_library" />
        <NativeTabs.Trigger.Label>Shelf</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
