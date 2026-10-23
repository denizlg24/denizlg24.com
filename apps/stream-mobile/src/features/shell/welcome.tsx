import { memberSetupSchema, type ProfileColor } from "@repo/schemas/stream";
import { Sparkles } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useSetUpMember } from "@/api/stream";
import { ColorPicker } from "@/features/profiles/color-picker";
import { NetworkError } from "@/lib/api";
import { session } from "@/lib/auth";
import { Avatar, Button, colors, radius, spacing, Text } from "@/ui";
import { GateScreen } from "./gate-screen";

/**
 * `GET /me` answered 409 `needs_setup`: a family account's first visit.
 * One step, a name and a colour, which `POST /me` turns into the account and
 * its first profile; the sofa follows.
 */
export function Welcome() {
  const setUp = useSetUpMember();
  const [name, setName] = useState("");
  const [color, setColor] = useState<ProfileColor>("ember");
  const input = memberSetupSchema.safeParse({ name, color });

  const error = setUp.error
    ? setUp.error instanceof NetworkError
      ? "We couldn't reach Stream. Check your connection and try again."
      : "That didn't work. Please try again."
    : null;

  return (
    <GateScreen
      icon={Sparkles}
      title="Welcome! What should we call you?"
      message="This is the name on your profile. You can add more profiles for other people at home later, and change any of this whenever you like."
    >
      <View style={styles.preview}>
        <Avatar name={name || "?"} color={color} size={64} />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={colors.faint}
          maxLength={24}
          autoFocus
          autoCapitalize="words"
          autoComplete="name"
          returnKeyType="done"
          accessibilityLabel="Your name"
          style={[
            styles.input,
            { color: colors.paper, backgroundColor: colors.fill },
          ]}
        />
      </View>
      <Text variant="label" color="muted">
        Pick a colour
      </Text>
      <ColorPicker value={color} onChange={setColor} />
      {error ? (
        <Text variant="subheadline" color="danger">
          {error}
        </Text>
      ) : null}
      <Button
        label="Continue"
        size="large"
        block
        disabled={!input.success}
        loading={setUp.isPending}
        onPress={() => {
          if (input.success) setUp.mutate(input.data);
        }}
      />
      <Button
        label="Not you? Sign out"
        variant="ghost"
        block
        onPress={() => void session.signOut()}
      />
    </GateScreen>
  );
}

const styles = StyleSheet.create({
  preview: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  input: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    fontSize: 18,
  },
});
