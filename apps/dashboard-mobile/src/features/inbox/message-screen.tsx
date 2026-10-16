import { colors, Notice, spacing, Text } from "@repo/native-ui";
import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import {
  ActivityIndicator,
  Button,
  StyleSheet,
  useColorScheme,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { useEmail } from "@/api/inbox";
import { clock, dayLabel } from "@/lib/format";
import { emailDocument, hasRemoteContent, textAsHtml } from "./email-html";

export function MessageScreen({
  accountId,
  emailId,
}: {
  accountId: string;
  emailId: string;
}) {
  const router = useRouter();
  const email = useEmail(accountId, emailId);
  const dark = useColorScheme() === "dark";
  const [remote, setRemote] = useState(false);
  const data = email.data;
  const html = data ? data.htmlBody || textAsHtml(data.textBody ?? "") : "";
  const sender = data?.from[0];

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: "",
          headerRight: () =>
            data && sender ? (
              <Button
                title="Reply"
                onPress={() =>
                  router.push(
                    `/compose?accountId=${accountId}&replyTo=${emailId}`,
                  )
                }
              />
            ) : null,
        }}
      />
      {email.error ? <Notice message={email.error.message} /> : null}
      {data ? (
        <>
          <View style={styles.header}>
            <Text variant="title3">{data.subject || "(no subject)"}</Text>
            <Text variant="subheadline" tone="secondary" numberOfLines={2}>
              {sender?.name
                ? `${sender.name} <${sender.address}>`
                : sender?.address}
            </Text>
            <View style={styles.meta}>
              <Text variant="footnote" tone="tertiary">
                {dayLabel(data.date)} {clock(data.date)}
              </Text>
              {!remote && hasRemoteContent(html) ? (
                <Text
                  variant="footnote"
                  weight="semibold"
                  onPress={() => setRemote(true)}
                >
                  Load images
                </Text>
              ) : null}
            </View>
          </View>
          <WebView
            key={remote ? "remote" : "local"}
            originWhitelist={["about:blank"]}
            source={{ html: emailDocument(html, { remote, dark }) }}
            javaScriptEnabled={false}
            style={styles.web}
            onShouldStartLoadWithRequest={(request) => {
              if (request.url === "about:blank") return true;
              if (/^https?:/.test(request.url)) {
                void WebBrowser.openBrowserAsync(request.url);
              }
              return false;
            }}
          />
        </>
      ) : (
        <ActivityIndicator style={{ padding: spacing.xxl }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  meta: { flexDirection: "row", justifyContent: "space-between" },
  web: { flex: 1, backgroundColor: "transparent" },
});
