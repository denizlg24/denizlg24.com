import type { Profile } from "@repo/schemas/stream";
import { Check, LogOut, Play, Users, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { useMe } from "@/api/stream";
import { toggleSofa } from "@/lib/audience";
import { seatAudience, useAudienceIds } from "@/lib/audience-store";
import { session } from "@/lib/auth";
import { colors, spacing, Wordmark } from "@/ui";
import { Focusable } from "./focusable";
import { SCREEN, TV_SAFE } from "./layout";
import { ProfileSquare } from "./shell";
import { TvButton } from "./tv-button";
import { TvText } from "./tv-text";

const TILE_GAP = 28;
const MAX_TILE = 124;

/**
 * "Who's watching?": a centred row of profiles where OK starts at once.
 * Watch together turns the row into toggles, for everyone on the sofa, and
 * Start blends their tastes. Profiles are added and edited on the phone.
 */
export function TvWhoScreen({ onStarted }: { onStarted?: () => void }) {
  const me = useMe();
  const stored = useAudienceIds();
  const profiles = me.data?.profiles ?? [];
  const [together, setTogether] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);

  const start = (ids: string[]) => {
    if (ids.length === 0) return;
    seatAudience(ids);
    onStarted?.();
  };

  const beginTogether = () => {
    setSelection(
      (stored ?? []).filter((id) => profiles.some((p) => p.id === id)),
    );
    setTogether(true);
  };

  // Also shown outside the navigator (nobody seated yet), so no focus effect.
  useEffect(() => {
    if (!together) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setTogether(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [together]);

  const tiles = profiles.length + (together || profiles.length < 2 ? 0 : 1);
  const size = Math.min(
    MAX_TILE,
    Math.floor(
      (SCREEN.width - TV_SAFE.x * 2 - TILE_GAP * Math.max(0, tiles - 1)) /
        Math.max(1, tiles),
    ),
  );

  return (
    <View style={styles.screen}>
      <View style={styles.brand}>
        <Wordmark size={26} />
      </View>
      <View style={styles.center}>
        <TvText variant="marquee" style={styles.centerText}>
          {together ? "Who's watching together?" : "Who's watching?"}
        </TvText>
        {together ? (
          <TvText variant="lede" color="muted" style={styles.centerText}>
            Choose everyone on the sofa, then Start. We'll mix your tastes.
          </TvText>
        ) : null}
        {/* Remounted on a mode change, so the first tile takes focus again. */}
        <View key={together ? "together" : "one"} style={styles.row}>
          {profiles.map((profile, index) => (
            <ProfileTile
              key={profile.id}
              profile={profile}
              size={size}
              preferred={index === 0}
              selected={together && selection.includes(profile.id)}
              together={together}
              onPress={() => {
                if (!together) {
                  start([profile.id]);
                  return;
                }
                setSelection(
                  (current) => toggleSofa(current, profile, profiles).selection,
                );
              }}
            />
          ))}
          {!together && profiles.length > 1 ? (
            <Focusable
              accessibilityRole="button"
              accessibilityLabel="Watch together"
              onPress={beginTogether}
              radius={12}
              grow={1.08}
              next={{ right: "self" }}
            >
              {(focused) => (
                <View style={[styles.tile, { width: size }]}>
                  <View
                    style={[
                      styles.together,
                      { width: size, height: size, borderRadius: size * 0.12 },
                    ]}
                  >
                    <Users
                      size={size * 0.38}
                      color={focused ? colors.paper : colors.muted}
                      strokeWidth={1.6}
                    />
                  </View>
                  <TvText
                    variant={focused ? "bodyStrong" : "body"}
                    color={focused ? "paper" : "muted"}
                    numberOfLines={1}
                  >
                    Watch together
                  </TvText>
                </View>
              )}
            </Focusable>
          ) : null}
        </View>
        {together ? (
          <View style={styles.actions}>
            <TvButton
              label={
                selection.length > 1
                  ? `Start, ${selection.length} watching`
                  : "Start"
              }
              icon={Play}
              filledIcon
              disabled={selection.length === 0}
              onPress={() => start(selection)}
            />
            <TvButton
              label="Cancel"
              icon={X}
              next={{ right: "self" }}
              onPress={() => setTogether(false)}
            />
          </View>
        ) : null}
      </View>
      <View style={styles.footer}>
        <TvText variant="meta" color="muted" style={styles.shrink}>
          To add or change a profile, use Stream on your phone.
        </TvText>
        <TvButton
          label="Sign out of this TV"
          icon={LogOut}
          next={{ right: "self" }}
          onPress={() => void session.signOut()}
        />
      </View>
    </View>
  );
}

function ProfileTile({
  profile,
  size,
  preferred,
  selected,
  together,
  onPress,
}: {
  profile: Profile;
  size: number;
  preferred: boolean;
  selected: boolean;
  together: boolean;
  onPress: () => void;
}) {
  return (
    <Focusable
      accessibilityRole={together ? "checkbox" : "button"}
      accessibilityLabel={profile.name}
      accessibilityState={together ? { checked: selected } : undefined}
      preferred={preferred}
      onPress={onPress}
      radius={12}
      grow={1.08}
    >
      {(focused) => (
        <View style={[styles.tile, { width: size }]}>
          <View style={{ opacity: together && !selected ? 0.55 : 1 }}>
            <ProfileSquare profile={profile} size={size} />
            {selected ? (
              <View style={styles.check}>
                <Check size={18} color={colors.ink} strokeWidth={3} />
              </View>
            ) : null}
          </View>
          <TvText
            variant={focused || selected ? "bodyStrong" : "body"}
            color={focused || selected ? "paper" : "muted"}
            numberOfLines={1}
          >
            {profile.name}
          </TvText>
        </View>
      )}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  brand: { position: "absolute", left: TV_SAFE.x, top: TV_SAFE.y },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
    paddingHorizontal: TV_SAFE.x,
  },
  centerText: { textAlign: "center" },
  row: {
    flexDirection: "row",
    justifyContent: "center",
    gap: TILE_GAP,
    marginTop: spacing.md,
  },
  tile: { alignItems: "center", gap: spacing.md },
  together: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  check: {
    position: "absolute",
    right: 6,
    top: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.amber,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { flexDirection: "row", gap: spacing.md },
  footer: {
    position: "absolute",
    left: TV_SAFE.x,
    right: TV_SAFE.x,
    bottom: TV_SAFE.y,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xl,
  },
  shrink: { flexShrink: 1 },
});
