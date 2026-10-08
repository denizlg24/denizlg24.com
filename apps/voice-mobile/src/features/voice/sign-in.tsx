import { useAuthState } from "@repo/native-auth/react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { auth } from "@/lib/auth";

export function SignIn() {
  const state = useAuthState(auth);
  const dark = useColorScheme() === "dark";
  return (
    <View
      style={[styles.screen, { backgroundColor: dark ? "#000000" : "#f9f8f6" }]}
    >
      <Text style={[styles.title, { color: dark ? "#ffffff" : "#000000" }]}>
        Voice
      </Text>
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={state.signingIn}
        onPress={() => void auth.signIn()}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: dark ? "#ffffff" : "#000000" },
          pressed && { opacity: 0.7 },
        ]}
      >
        {state.signingIn ? (
          <ActivityIndicator color={dark ? "#000000" : "#ffffff"} />
        ) : (
          <Text
            style={[styles.buttonText, { color: dark ? "#000000" : "#ffffff" }]}
          >
            Sign in
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 20,
    paddingBottom: 60,
    gap: 16,
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    position: "absolute",
    top: "42%",
    alignSelf: "center",
  },
  error: { color: "#ff3b30", fontSize: 13 },
  button: {
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 17, fontWeight: "600" },
});
