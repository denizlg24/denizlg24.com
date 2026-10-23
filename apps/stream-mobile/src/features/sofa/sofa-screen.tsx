import { MAX_PROFILES, type Profile } from "@repo/schemas/stream";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Plus } from "lucide-react-native";
import { use, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMe } from "@/api/stream";
import { audienceNames, toggleSofa } from "@/lib/audience";
import {
  AudienceContext,
  seatAudience,
  useAudienceIds,
} from "@/lib/audience-store";
import { Avatar, Button, colors, gutter, spacing, Text } from "@/ui";

const DISC = 104;

/**
 * "Who's on the sofa?" Studio profiles toggle, so several can sit down
 * together; a classic profile is single-select and starts at once.
 */
export function SofaScreen() {
  const insets = useSafeAreaInsets();
  const me = useMe();
  const stored = useAudienceIds();
  const current = use(AudienceContext);
  const profiles = me.data?.profiles ?? [];
  const [selection, setSelection] = useState<string[]>(() =>
    (stored ?? []).filter((id) => profiles.some((p) => p.id === id)),
  );
  const [editing, setEditing] = useState(false);
  const [started, setStarted] = useState(false);
  const layoutAtOpen = useRef(current?.layout ?? null);

  // Once the new audience has reached the navigator, leave for its first surface.
  useEffect(() => {
    if (!started || !current) return;
    if (router.canGoBack() && layoutAtOpen.current === current.layout) {
      router.back();
    } else {
      router.replace("/");
    }
  }, [started, current]);

  const start = (ids: string[]) => {
    if (ids.length === 0) return;
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => undefined);
    seatAudience(ids);
    setStarted(true);
  };

  const tap = (profile: Profile) => {
    if (editing) {
      router.push({ pathname: "/profile-edit", params: { id: profile.id } });
      return;
    }
    const change = toggleSofa(selection, profile, profiles);
    setSelection(change.selection);
    if (change.start) start(change.selection);
  };

  const seated = profiles.filter((p) => selection.includes(p.id));
  const canAdd = profiles.length < MAX_PROFILES;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.xxxl,
            paddingBottom: insets.bottom + 140,
          },
        ]}
      >
        <Animated.View entering={FadeInDown.duration(500)}>
          <Text variant="marquee" accessibilityRole="header">
            {editing ? "Edit profiles" : "Who's on\nthe sofa?"}
          </Text>
        </Animated.View>
        <Text variant="body" color="muted" style={styles.lede}>
          {profiles.length === 0
            ? "Add a profile for each person at home, so everyone gets their own list and picks."
            : editing
              ? "Tap someone to change their name, colour or layout."
              : "Tap everyone who's watching. Picking a few of you blends your tastes, and if a kids profile joins, everything stays kid-friendly."}
        </Text>

        <View style={styles.grid}>
          {profiles.map((profile, index) => {
            const on = selection.includes(profile.id);
            return (
              <Animated.View
                key={profile.id}
                entering={FadeIn.delay(80 * index).duration(400)}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    editing ? `Edit ${profile.name}` : profile.name
                  }
                  accessibilityState={{ selected: on }}
                  onPress={() => tap(profile)}
                  style={({ pressed }) => [
                    styles.seat,
                    {
                      opacity: pressed ? 0.7 : editing || on ? 1 : 0.62,
                    },
                  ]}
                >
                  <Avatar
                    name={profile.name}
                    color={profile.color}
                    size={DISC}
                    selected={on && !editing}
                  />
                  <Text variant="heading" numberOfLines={1}>
                    {profile.name}
                  </Text>
                  <Text variant="caption" color="muted">
                    {[
                      profile.kids ? "Kids" : null,
                      profile.layout === "classic" ? "Simple layout" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || " "}
                  </Text>
                </Pressable>
              </Animated.View>
            );
          })}
          {canAdd ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a profile"
              onPress={() => router.push("/profile-edit")}
              style={({ pressed }) => [
                styles.seat,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={styles.add}>
                <Plus color={colors.muted} size={34} strokeWidth={1.4} />
              </View>
              <Text variant="heading" color="muted">
                Add someone
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}
      >
        {!editing ? (
          <Button
            label={
              seated.length === 0
                ? "Tap who's watching"
                : `Start with ${audienceNames(seated)}`
            }
            size="large"
            block
            disabled={seated.length === 0}
            onPress={() => start(selection)}
          />
        ) : null}
        {profiles.length > 0 ? (
          <Button
            label={editing ? "Done" : "Edit profiles"}
            variant="ghost"
            block
            onPress={() => setEditing((value) => !value)}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { paddingHorizontal: gutter, gap: spacing.lg },
  lede: { maxWidth: 380 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xl,
    marginTop: spacing.xl,
  },
  seat: { width: DISC + 8, alignItems: "center", gap: spacing.xs },
  add: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.ink,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
});
