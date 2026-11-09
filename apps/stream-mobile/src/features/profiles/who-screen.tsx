import { MAX_PROFILES, type Profile } from "@repo/schemas/stream";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Check, Pencil, Plus, Users, X } from "lucide-react-native";
import { use, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMe } from "@/api/stream";
import { audienceNames, toggleSofa } from "@/lib/audience";
import {
  AudienceContext,
  seatAudience,
  useAudienceIds,
} from "@/lib/audience-store";
import {
  Avatar,
  Button,
  colors,
  IconButton,
  spacing,
  Text,
  Wordmark,
} from "@/ui";

type Mode = "pick" | "together" | "edit";

/**
 * "Who's watching?" Tap a profile to start straight away. "Watch together"
 * turns the tiles into toggles for several people at once, and Edit opens a
 * profile instead.
 */
export function WhoScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const me = useMe();
  const stored = useAudienceIds();
  const current = use(AudienceContext);
  const profiles = me.data?.profiles ?? [];
  const [mode, setMode] = useState<Mode>("pick");
  const [selection, setSelection] = useState<string[]>(() =>
    (stored ?? []).filter((id) => profiles.some((p) => p.id === id)),
  );
  const [started, setStarted] = useState(false);
  const tile = Math.min(132, Math.floor((width - 48 * 2 - 28) / 2));

  // Once the new audience reaches the navigator, leave for Home.
  useEffect(() => {
    if (!started || !current) return;
    if (router.canGoBack()) router.back();
    else router.replace("/home");
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
    if (mode === "edit") {
      router.push({ pathname: "/profile-edit", params: { id: profile.id } });
    } else if (mode === "together") {
      void Haptics.selectionAsync().catch(() => undefined);
      setSelection(toggleSofa(selection, profile, profiles).selection);
    } else {
      start([profile.id]);
    }
  };

  const seated = selection
    .map((id) => profiles.find((p) => p.id === id))
    .filter((p): p is Profile => p !== undefined);
  const canAdd = profiles.length < MAX_PROFILES;

  return (
    <View style={styles.screen}>
      <View style={[styles.bar, { paddingTop: insets.top }]}>
        <View style={styles.side}>
          {current && mode === "pick" ? (
            <IconButton icon={X} label="Close" onPress={() => router.back()} />
          ) : null}
        </View>
        <Wordmark size={24} />
        <View style={[styles.side, styles.right]}>
          {profiles.length > 0 && mode !== "together" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                mode === "edit" ? "Done editing" : "Edit profiles"
              }
              hitSlop={8}
              onPress={() => setMode(mode === "edit" ? "pick" : "edit")}
              style={({ pressed }) => [
                styles.edit,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              {mode === "edit" ? null : (
                <Pencil color={colors.paper} size={16} />
              )}
              <Text variant="callout">{mode === "edit" ? "Done" : "Edit"}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 180 },
        ]}
      >
        <Text variant="title" style={styles.center} accessibilityRole="header">
          {mode === "edit"
            ? "Edit profiles"
            : mode === "together"
              ? "Who's watching together?"
              : "Who's watching?"}
        </Text>
        {mode === "together" ? (
          <Text
            variant="footnote"
            color="muted"
            style={[styles.center, styles.hint]}
          >
            Tap everyone on the sofa. Stream mixes your tastes, and if a kids
            profile joins, everything stays kid-friendly.
          </Text>
        ) : null}

        <View style={[styles.grid, { width: tile * 2 + 28 }]}>
          {profiles.map((profile, index) => {
            const on = mode === "together" && selection.includes(profile.id);
            return (
              <Animated.View
                key={profile.id}
                entering={FadeIn.delay(60 * index).duration(300)}
                style={{ width: tile }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    mode === "edit" ? `Edit ${profile.name}` : profile.name
                  }
                  accessibilityState={{ selected: on }}
                  onPress={() => tap(profile)}
                  style={({ pressed }) => [
                    styles.tile,
                    {
                      opacity: pressed
                        ? 0.7
                        : mode === "together" && !on
                          ? 0.55
                          : 1,
                    },
                  ]}
                >
                  <View>
                    <Avatar
                      name={profile.name}
                      color={profile.color}
                      size={tile}
                      square
                      selected={on}
                    />
                    {mode === "edit" ? (
                      <View
                        style={[styles.overlay, { borderRadius: tile * 0.12 }]}
                      >
                        <Pencil color={colors.paper} size={28} />
                      </View>
                    ) : null}
                    {on ? (
                      <View style={styles.check}>
                        <Check
                          color={colors.onAmber}
                          size={16}
                          strokeWidth={3}
                        />
                      </View>
                    ) : null}
                  </View>
                  <Text
                    variant="callout"
                    numberOfLines={1}
                    style={styles.center}
                  >
                    {profile.name}
                  </Text>
                  {profile.kids ? (
                    <Text variant="caption" color="muted" style={styles.center}>
                      Kids
                    </Text>
                  ) : null}
                </Pressable>
              </Animated.View>
            );
          })}
          {canAdd && mode !== "together" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a profile"
              onPress={() => router.push("/profile-edit")}
              style={({ pressed }) => [
                styles.tile,
                { width: tile, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View
                style={[
                  styles.add,
                  { width: tile, height: tile, borderRadius: tile * 0.12 },
                ]}
              >
                <Plus color={colors.muted} size={36} strokeWidth={1.4} />
              </View>
              <Text
                variant="callout"
                color="muted"
                numberOfLines={1}
                style={styles.center}
              >
                Add profile
              </Text>
            </Pressable>
          ) : null}
        </View>
        {profiles.length === 0 ? (
          <Text
            variant="body"
            color="muted"
            style={[styles.center, styles.hint]}
          >
            Add a profile for each person at home, so everyone gets their own
            list and suggestions.
          </Text>
        ) : null}
      </ScrollView>

      {profiles.length > 1 && mode !== "edit" ? (
        <View
          style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}
        >
          {mode === "together" ? (
            <>
              <Button
                label={
                  seated.length === 0
                    ? "Tap who's watching"
                    : `Start with ${audienceNames(seated)}`
                }
                size="large"
                rounded
                block
                disabled={seated.length === 0}
                onPress={() => start(selection)}
              />
              <Button
                label="Cancel"
                variant="ghost"
                block
                onPress={() => setMode("pick")}
              />
            </>
          ) : (
            <Button
              label="Watch together"
              icon={Users}
              variant="secondary"
              size="large"
              rounded
              block
              onPress={() => setMode("together")}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    minHeight: 52,
  },
  side: { width: 88, flexDirection: "row" },
  right: { justifyContent: "flex-end" },
  edit: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  content: { paddingTop: spacing.xxl, gap: spacing.lg, alignItems: "center" },
  center: { textAlign: "center" },
  hint: { maxWidth: 320, paddingHorizontal: spacing.lg },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 28,
    rowGap: spacing.xl,
    marginTop: spacing.lg,
  },
  tile: { alignItems: "center", gap: spacing.sm },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(12,11,10,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  check: {
    position: "absolute",
    right: -6,
    top: -6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.amber,
    alignItems: "center",
    justifyContent: "center",
  },
  add: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.faint,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.ink,
  },
});
