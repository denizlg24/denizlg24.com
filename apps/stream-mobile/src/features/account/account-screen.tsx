import { MAX_PROFILES } from "@repo/schemas/stream";
import Constants from "expo-constants";
import { router } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMe } from "@/api/stream";
import { seatAudience } from "@/lib/audience-store";
import { session } from "@/lib/auth";
import { Avatar, Button, colors, gutter, spacing, Text } from "@/ui";

/** Profiles and the account: edit people, change who's watching, sign out. */
export function AccountScreen() {
  const insets = useSafeAreaInsets();
  const me = useMe();
  const profiles = me.data?.profiles ?? [];

  const signOut = () =>
    Alert.alert("Sign out of Stream?", "You can sign back in any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          seatAudience(null);
          void session.signOut();
        },
      },
    ]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      <Text variant="display">Profiles</Text>
      <Text variant="body" color="muted">
        Everyone at home can have their own profile, with their own list, picks
        and layout.
      </Text>
      <View style={styles.list}>
        {profiles.map((profile) => (
          <Pressable
            key={profile.id}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${profile.name}`}
            onPress={() =>
              router.push({
                pathname: "/profile-edit",
                params: { id: profile.id },
              })
            }
            style={({ pressed }) => [
              styles.row,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Avatar name={profile.name} color={profile.color} size={48} />
            <View style={styles.grow}>
              <Text variant="headline">{profile.name}</Text>
              <Text variant="footnote" color="muted">
                {[
                  profile.layout === "classic"
                    ? "Simple layout, bigger text"
                    : "Full layout",
                  profile.kids ? "Kids" : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </Text>
            </View>
            <Text variant="callout" color="amber">
              Edit
            </Text>
          </Pressable>
        ))}
      </View>
      {profiles.length < MAX_PROFILES ? (
        <Button
          label="Add someone"
          variant="secondary"
          block
          onPress={() => router.push("/profile-edit")}
        />
      ) : null}
      <Button
        label="Change who's watching"
        variant="secondary"
        block
        onPress={() => {
          router.back();
          router.push("/sofa");
        }}
      />
      <View style={styles.rule} />
      {me.data ? (
        <Text variant="footnote" color="muted">
          Signed in as {me.data.member.name}
        </Text>
      ) : null}
      <Button label="Sign out" variant="destructive" block onPress={signOut} />
      <Text variant="caption" color="faint">
        Stream {Constants.expoConfig?.version ?? ""}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.raised },
  content: { padding: gutter, gap: spacing.lg },
  list: { gap: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  grow: { flex: 1, gap: spacing.xxs },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.md,
  },
});
