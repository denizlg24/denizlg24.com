import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";
import { Linking } from "react-native";
import { API_URL } from "@/lib/config";
import { Screen, spacing, Text, VStack } from "@/ui";

export interface AuthNotice {
  tone: "info" | "error";
  message: string;
}

/**
 * Every auth screen: large title from the layout, a one-line lead, then the
 * form. The scroll view insets itself for the keyboard so the primary button
 * stays reachable under a raised keyboard.
 */
export function AuthScreen({
  lead,
  children,
}: {
  lead?: string;
  children: ReactNode;
}) {
  return (
    <Screen automaticallyAdjustKeyboardInsets>
      <VStack gap={spacing.xl}>
        {lead ? (
          <Text variant="body" tone="secondary">
            {lead}
          </Text>
        ) : null}
        {children}
      </VStack>
    </Screen>
  );
}

/** Opens Mail on its inbox. False when no mail app handles `message:`. */
export async function openMail(): Promise<boolean> {
  try {
    await Linking.openURL("message://");
    return true;
  } catch {
    return false;
  }
}

export function openWebPage(path: string) {
  void WebBrowser.openBrowserAsync(`${API_URL}${path}`, {
    dismissButtonStyle: "done",
  }).catch(() => undefined);
}
