import {
  Button,
  Field,
  Stack as Gap,
  Notice,
  Row,
  Screen,
  Section,
  spacing,
  Text,
} from "@repo/native-ui";
import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import {
  aiConnectionsKey,
  aiSubscriptionsKey,
  disconnectGateway,
  disconnectSubscription,
  saveGateway,
  saveSubscription,
  testGateway,
  useAiConnections,
  useAiSubscriptions,
} from "@/api/ai-connections";
import { QueryState } from "@/features/shell/tab-page";
import { SITE } from "@/lib/config";

const providerNames = {
  gateway: "AI Gateway",
  chatgpt: "ChatGPT subscription",
  "claude-code": "Claude Code subscription",
};
const gatewayStatuses = {
  connected: "Connected",
  unverified: "Not tested",
  error: "Error",
  disconnected: "Disconnected",
};
const gatewaySources = {
  stored: "Saved API key",
  environment: "Server environment",
  oauth: "Vercel OAuth",
};
const inputProps = {
  autoCapitalize: "none",
  autoCorrect: false,
  spellCheck: false,
  autoComplete: "off",
} as const;

export function AiConnectionsScreen() {
  const client = useQueryClient();
  const connections = useAiConnections();
  const subscriptions = useAiSubscriptions();
  const [apiKey, setApiKey] = useState("");
  const [team, setTeam] = useState<string | null>(null);
  const [claudeToken, setClaudeToken] = useState("");
  const [chatgptModel, setChatgptModel] = useState<string | null>(null);
  const [claudeModel, setClaudeModel] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const gateway = connections.data?.gateway;
  const saved = subscriptions.data;
  const busy = pending !== null;

  const refresh = async () => {
    await Promise.all([connections.refetch(), subscriptions.refetch()]);
  };

  const run = async (action: string, work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setPending(action);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Request failed. Try again.",
      );
    } finally {
      locked.current = false;
      setPending(null);
    }
  };

  const updateGateway = async (work: typeof testGateway) => {
    const status = await work();
    await client.cancelQueries({ queryKey: aiConnectionsKey });
    client.setQueryData(aiConnectionsKey, status);
  };

  const selectSubscription = async (
    input: Parameters<typeof saveSubscription>[0],
  ) => {
    const status = await saveSubscription(input);
    setClaudeToken("");
    await client.cancelQueries({ queryKey: aiSubscriptionsKey });
    client.setQueryData(aiSubscriptionsKey, status);
  };

  const remove = (provider: "gateway" | "chatgpt" | "claude-code") => {
    Alert.alert(
      `Disconnect ${providerNames[provider]}?`,
      provider === "gateway"
        ? "A saved server key will be used if one is configured."
        : "If this provider is selected, agent requests will stop until you reconnect or choose another provider.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () =>
            void run(`remove-${provider}`, async () => {
              if (provider === "gateway") {
                await updateGateway(disconnectGateway);
              } else {
                const status = await disconnectSubscription(provider);
                if (status.revocationConfirmed === false) {
                  setError(
                    "Disconnected here. Remove the app in ChatGPT settings to finish signing out.",
                  );
                }
                await client.cancelQueries({ queryKey: aiSubscriptionsKey });
                client.setQueryData(aiSubscriptionsKey, status);
              }
              await refresh();
            }),
        },
      ],
    );
  };

  const openSettings = () =>
    void run("browser", async () => {
      // Browser admin login is separate from native bearer authentication.
      await WebBrowser.openBrowserAsync(
        `${SITE}/admin/dashboard/settings/models`,
      );
      await refresh();
    });

  return (
    <Screen
      onRefresh={() => {
        if (!busy) void refresh();
      }}
      refreshing={connections.isRefetching || subscriptions.isRefetching}
    >
      <Stack.Screen options={{ title: "AI connections" }} />
      <Gap>
        <Section title="Active provider">
          <QueryState
            error={subscriptions.error}
            loading={subscriptions.isPending}
          />
          {saved ? (
            <Row title="Selected" value={providerNames[saved.activeProvider]} />
          ) : null}
          <Text variant="footnote" tone="secondary">
            This selection applies across dashboard clients. ChatGPT and Claude
            Code use your own subscription and its limits. AI Gateway uses
            separately billed Gateway credits. Subscription failures do not
            automatically fall back to paid Gateway credits.
          </Text>
          <Text variant="footnote" tone="secondary">
            Saved subscriptions are verified when an AI request runs.
          </Text>
        </Section>

        {error ? <Notice message={error} /> : null}
        {connections.error || subscriptions.error ? (
          <Button
            label="Retry loading connections"
            variant="plain"
            disabled={busy}
            onPress={() => void refresh()}
          />
        ) : null}

        <Section title="AI Gateway">
          <QueryState
            error={connections.error}
            loading={connections.isPending}
          />
          {gateway ? (
            <Gap gap={spacing.md}>
              <Row
                title="Status"
                value={gatewayStatuses[gateway.status]}
                subtitle={
                  gateway.source
                    ? gatewaySources[gateway.source]
                    : "No Gateway connection"
                }
              />
              {gateway.lastError ? (
                <Notice message={gateway.lastError} />
              ) : null}
              <Field
                label="API key"
                accessibilityLabel="Gateway API key"
                {...inputProps}
                secureTextEntry
                value={apiKey}
                placeholder={
                  gateway.configured ? "Enter replacement key" : "Enter API key"
                }
                editable={!busy}
                onChangeText={setApiKey}
              />
              <Field
                label="Team"
                accessibilityLabel="Gateway team ID or slug"
                {...inputProps}
                value={team ?? gateway.teamIdOrSlug ?? ""}
                placeholder="Optional team ID or slug"
                editable={!busy}
                onChangeText={setTeam}
              />
              <Button
                label="Save Gateway key"
                loading={pending === "save-gateway"}
                disabled={busy || !apiKey.trim()}
                onPress={() =>
                  void run("save-gateway", async () => {
                    const teamIdOrSlug = (
                      team ??
                      gateway.teamIdOrSlug ??
                      ""
                    ).trim();
                    const status = await saveGateway({
                      apiKey: apiKey.trim(),
                      ...(teamIdOrSlug ? { teamIdOrSlug } : {}),
                    });
                    setApiKey("");
                    setTeam(null);
                    await client.cancelQueries({ queryKey: aiConnectionsKey });
                    client.setQueryData(aiConnectionsKey, status);
                  })
                }
              />
              <Button
                label="Test saved Gateway connection"
                variant="plain"
                loading={pending === "test-gateway"}
                disabled={busy || !gateway.configured}
                onPress={() =>
                  void run("test-gateway", () => updateGateway(testGateway))
                }
              />
              <Button
                label="Use Gateway credits"
                variant="tinted"
                loading={pending === "select-gateway"}
                disabled={
                  busy ||
                  !gateway.configured ||
                  !saved ||
                  saved.activeProvider === "gateway"
                }
                onPress={() =>
                  void run("select-gateway", () =>
                    selectSubscription({ provider: "gateway" }),
                  )
                }
              />
              {gateway.source === "stored" || gateway.source === "oauth" ? (
                <Button
                  label="Disconnect saved Gateway"
                  variant="destructive"
                  disabled={busy}
                  loading={pending === "remove-gateway"}
                  onPress={() => remove("gateway")}
                />
              ) : null}
              {gateway.source === "environment" ? (
                <Text variant="footnote" tone="secondary">
                  This connection is managed by the server environment. A saved
                  key overrides it; removing the saved key can reveal the
                  environment connection again.
                </Text>
              ) : null}
              {connections.data?.vercelOAuthAvailable ? (
                <>
                  <Button
                    label="Connect Vercel in browser"
                    variant="plain"
                    disabled={busy}
                    onPress={openSettings}
                  />
                  <Text variant="footnote" tone="secondary">
                    Sign in as an admin in the browser, then authorize Vercel in
                    dashboard settings.
                  </Text>
                </>
              ) : null}
            </Gap>
          ) : null}
        </Section>

        {saved ? (
          <>
            <Section title="ChatGPT subscription">
              <Gap gap={spacing.md}>
                <Row
                  title="Account"
                  value={saved.chatgpt.configured ? "Saved" : "Setup required"}
                  subtitle={saved.chatgpt.accountLabel ?? undefined}
                />
                {saved.chatgpt.lastError ? (
                  <Notice message={saved.chatgpt.lastError} />
                ) : null}
                <Text variant="footnote" tone="secondary">
                  First connect on a computer using the local browser helper:
                </Text>
                <Text variant="footnote" selectable>
                  {`cd apps/web && bun scripts/connect-chatgpt.ts --host-id ${saved.chatgpt.hostId}`}
                </Text>
                <Text variant="footnote" tone="secondary">
                  Import the generated protected JSON in web or desktop
                  dashboard settings. Then refresh here and select the saved
                  account.
                </Text>
                <Field
                  label="Model"
                  accessibilityLabel="ChatGPT model"
                  {...inputProps}
                  value={chatgptModel ?? saved.chatgpt.model ?? ""}
                  placeholder="Saved model"
                  editable={!busy}
                  onChangeText={setChatgptModel}
                />
                <Button
                  label="Use saved ChatGPT account"
                  loading={pending === "select-chatgpt"}
                  disabled={busy || !saved.chatgpt.configured}
                  onPress={() =>
                    void run("select-chatgpt", async () => {
                      const model = (
                        chatgptModel ??
                        saved.chatgpt.model ??
                        ""
                      ).trim();
                      await selectSubscription({
                        provider: "chatgpt",
                        ...(model ? { model } : {}),
                      });
                    })
                  }
                />
                {saved.chatgpt.configured ? (
                  <Button
                    label="Disconnect ChatGPT"
                    variant="destructive"
                    disabled={busy}
                    loading={pending === "remove-chatgpt"}
                    onPress={() => remove("chatgpt")}
                  />
                ) : null}
              </Gap>
            </Section>

            <Section title="Claude Code subscription">
              <Gap gap={spacing.md}>
                <Row
                  title="Account"
                  value={saved.claude.configured ? "Saved" : "Setup required"}
                />
                <Text variant="footnote" tone="secondary">
                  Run claude setup-token on your computer and paste your own
                  setup token here. Saving selects this subscription. Leave the
                  token blank to use an existing saved account.
                </Text>
                <Field
                  label="Setup token"
                  accessibilityLabel="Claude Code setup token"
                  {...inputProps}
                  secureTextEntry
                  value={claudeToken}
                  placeholder={
                    saved.claude.configured
                      ? "Enter replacement token"
                      : "Paste setup token"
                  }
                  editable={!busy}
                  onChangeText={setClaudeToken}
                />
                <Field
                  label="Model"
                  accessibilityLabel="Claude Code model"
                  {...inputProps}
                  value={claudeModel ?? saved.claude.model ?? ""}
                  placeholder="Server default"
                  editable={!busy}
                  onChangeText={setClaudeModel}
                />
                <Button
                  label={
                    claudeToken.trim()
                      ? "Save and use Claude Code"
                      : "Use saved Claude Code account"
                  }
                  loading={pending === "select-claude"}
                  disabled={
                    busy || (!claudeToken.trim() && !saved.claude.configured)
                  }
                  onPress={() =>
                    void run("select-claude", async () => {
                      const token = claudeToken.trim();
                      const model = (
                        claudeModel ??
                        saved.claude.model ??
                        ""
                      ).trim();
                      await selectSubscription({
                        provider: "claude-code",
                        ...(token ? { token } : {}),
                        ...(model ? { model } : {}),
                      });
                    })
                  }
                />
                {saved.claude.configured ? (
                  <Button
                    label="Disconnect Claude Code"
                    variant="destructive"
                    disabled={busy}
                    loading={pending === "remove-claude-code"}
                    onPress={() => remove("claude-code")}
                  />
                ) : null}
              </Gap>
            </Section>
          </>
        ) : null}

        <Button
          label="Open dashboard settings in browser"
          variant="plain"
          disabled={busy}
          loading={pending === "browser"}
          onPress={openSettings}
        />
        <Text variant="footnote" tone="secondary">
          Browser setup requires a separate admin login. Return here and pull to
          refresh after connecting an account on another device.
        </Text>
      </Gap>
    </Screen>
  );
}
