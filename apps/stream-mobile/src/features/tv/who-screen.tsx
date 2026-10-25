import type { Profile } from "@repo/schemas/stream";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useMe } from "@/api/stream";
import { toggleSofa } from "@/lib/audience";
import { seatAudience, useAudienceIds } from "@/lib/audience-store";
import { session } from "@/lib/auth";
import { Avatar, Button, colors, spacing, Text, Wordmark } from "@/ui";
import { Focusable } from "./focusable";
import { TV_SAFE } from "./layout";

const DISC = 112;

/**
 * "Who's watching?" on the TV. The same sofa rules as the phone: studio
 * profiles sit down together, a classic one starts on its own. Profiles are
 * added and edited on the phone.
 */
export function TvWhoScreen({ onStarted }: { onStarted?: () => void }) {
  const me = useMe();
  const stored = useAudienceIds();
  const profiles = me.data?.profiles ?? [];
  const [selection, setSelection] = useState<string[]>(() =>
    (stored ?? []).filter((id) => profiles.some((p) => p.id === id)),
  );

  const start = (ids: string[]) => {
    if (ids.length === 0) return;
    seatAudience(ids);
    onStarted?.();
  };

  const choose = (profile: Profile) => {
    const change = toggleSofa(selection, profile, profiles);
    setSelection(change.selection);
    if (change.start) start(change.selection);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Wordmark size={30} />
      <View style={styles.copy}>
        <Text variant="hero">Who's watching?</Text>
        <Text variant="lede" color="muted">
          Choose everyone on the sofa, then Start. Picking a few of you blends
          your tastes. To add or change a profile, use Stream on your phone.
        </Text>
      </View>
      <View style={styles.row}>
        {profiles.map((profile, index) => {
          const on = selection.includes(profile.id);
          return (
            <Focusable
              key={profile.id}
              preferred={index === 0}
              radius={DISC / 2}
              accessibilityRole="button"
              accessibilityLabel={profile.name}
              accessibilityState={{ selected: on }}
              onPress={() => choose(profile)}
              style={styles.seat}
            >
              <Avatar
                name={profile.name}
                color={profile.color}
                size={DISC}
                selected={on}
              />
              <Text
                variant="headline"
                color={on ? "paper" : "muted"}
                numberOfLines={1}
              >
                {profile.name}
              </Text>
            </Focusable>
          );
        })}
      </View>
      <View style={styles.actions}>
        <Button
          label="Start"
          size="large"
          disabled={selection.length === 0}
          onPress={() => start(selection)}
        />
        <Button
          label="Sign out of this TV"
          variant="ghost"
          size="large"
          onPress={() => void session.signOut()}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: {
    paddingHorizontal: TV_SAFE.x,
    paddingVertical: TV_SAFE.y + spacing.sm,
    gap: spacing.xxl,
  },
  copy: { gap: spacing.sm, maxWidth: 640 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xxxl },
  seat: { alignItems: "center", gap: spacing.md, width: DISC + 24 },
  actions: { flexDirection: "row", gap: spacing.lg },
});
