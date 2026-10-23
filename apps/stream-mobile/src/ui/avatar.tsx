import type { Profile, ProfileColor } from "@repo/schemas/stream";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./text";
import { colors, fonts, profileColors } from "./theme";

export interface AvatarProps {
  name: string;
  color: ProfileColor;
  size?: number;
  /** An amber ring: this person is on the sofa. */
  selected?: boolean;
}

/** A profile's colour disc with its initial, the same wherever it appears. */
export function Avatar({ name, color, size = 72, selected }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const ring = selected ? Math.max(2, size * 0.04) : 0;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: profileColors[color],
          borderWidth: ring,
          borderColor: colors.amber,
        },
      ]}
    >
      <Text
        style={{
          color: colors.ink,
          fontFamily: fonts.display,
          fontSize: size * 0.52,
          lineHeight: size * 0.64,
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

/** Everyone on the sofa as overlapping discs; tapping them goes back to the sofa. */
export function AudienceDiscs({
  audience,
  size = 30,
  onPress,
}: {
  audience: Profile[];
  size?: number;
  onPress?: () => void;
}) {
  const names = audience.map((profile) => profile.name).join(" and ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Watching: ${names}. Change who's watching`}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.stack, { opacity: pressed ? 0.7 : 1 }]}
    >
      {audience.map((profile, index) => (
        <View
          key={profile.id}
          style={[
            styles.overlap,
            {
              marginLeft: index === 0 ? 0 : -size * 0.32,
              borderRadius: size / 2 + 2,
              zIndex: audience.length - index,
            },
          ]}
        >
          <Avatar name={profile.name} color={profile.color} size={size} />
        </View>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disc: { alignItems: "center", justifyContent: "center" },
  stack: { flexDirection: "row", alignItems: "center" },
  overlap: { borderWidth: 2, borderColor: colors.ink },
});
