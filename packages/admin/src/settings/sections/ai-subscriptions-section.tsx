"use client";

import {
  type ChatgptCredential,
  type ChatgptModelsResponse,
  chatgptCredentialSchema,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../../provider";
import {
  type AiSubscriptionsResponse,
  disconnectAiSubscription,
  getAiSubscriptions,
  getChatgptModels,
  type SaveAiSubscription,
  saveAiSubscription,
} from "../ai-connections-api";
import { SettingsGroup, SettingsRow } from "../settings-shell";

export function AiSubscriptionsSection() {
  const { client, platform } = useAdmin();
  const [data, setData] = useState<AiSubscriptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [chatgptModel, setChatgptModel] = useState("");
  const [claudeModel, setClaudeModel] = useState("");
  const [credentials, setCredentials] = useState<ChatgptCredential | null>(
    null,
  );
  const [models, setModels] = useState<ChatgptModelsResponse["models"]>([]);
  const [token, setToken] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileVersion = useRef(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setFailed(false);
      try {
        const next = await getAiSubscriptions(client, { signal });
        if (signal?.aborted) return;
        setData(next);
        setChatgptModel(next.chatgpt.model ?? "");
        setClaudeModel(next.claude.model ?? "");
      } catch {
        if (!signal?.aborted) setFailed(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      fileVersion.current += 1;
    };
  }, [load]);

  async function readCredentials(file: File | undefined) {
    const version = ++fileVersion.current;
    setCredentials(null);
    setReading(false);
    if (!file) return;
    setReading(true);
    try {
      if (file.size > 100_000) throw new Error("File too large");
      const value = chatgptCredentialSchema.parse(
        JSON.parse(await file.text()),
      );
      const available = await getChatgptModels(client, value);
      if (fileVersion.current === version) {
        setCredentials(value);
        setModels(available.models);
        setChatgptModel(available.models[0]?.slug ?? "");
      }
    } catch {
      if (fileVersion.current === version) {
        if (fileInput.current) fileInput.current.value = "";
        toast.error(
          "Could not load this ChatGPT connection. Run the sign-in helper again and choose its JSON file (up to 100 KB).",
        );
      }
    } finally {
      if (fileVersion.current === version) setReading(false);
    }
  }

  async function loadModels() {
    if (busy.current) return;
    busy.current = true;
    setReading(true);
    try {
      const available = await getChatgptModels(
        client,
        credentials ?? undefined,
      );
      setModels(available.models);
      setChatgptModel((current) =>
        available.models.some((entry) => entry.slug === current)
          ? current
          : (available.models[0]?.slug ?? ""),
      );
    } catch {
      toast.error(
        "Could not load ChatGPT models. Sign in again and check plan access.",
      );
    } finally {
      busy.current = false;
      setReading(false);
    }
  }

  async function save(input: SaveAiSubscription) {
    if (busy.current) return;
    busy.current = true;
    setAction(input.provider);
    try {
      await saveAiSubscription(client, input);
      setToken("");
      setCredentials(null);
      if (fileInput.current) fileInput.current.value = "";
      toast.success(
        input.provider === "gateway"
          ? "Gateway selected"
          : "Subscription saved",
      );
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save subscription settings",
      );
    } finally {
      busy.current = false;
      setAction(null);
    }
  }

  async function disconnect(provider: "chatgpt" | "claude-code") {
    if (busy.current) return;
    busy.current = true;
    setAction(`disconnect-${provider}`);
    try {
      const result = await disconnectAiSubscription(client, provider);
      if (result.revocationConfirmed === false)
        toast.warning(
          "Disconnected here. Remove the app in ChatGPT settings to finish signing out.",
        );
      setToken("");
      setCredentials(null);
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch {
      toast.error("Could not disconnect subscription");
    } finally {
      busy.current = false;
      setAction(null);
    }
  }

  const disabled = action !== null || loading || reading;

  return (
    <SettingsGroup
      label="Personal subscriptions"
      description="Billing: ChatGPT or Claude subscription · plan limits apply"
      actions={
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void load()}
        >
          Refresh
        </Button>
      }
    >
      {loading ? (
        <Skeleton className="h-9 w-full" />
      ) : failed ? (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <span className="text-sm text-muted-foreground">
            Could not load subscriptions
          </span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : data ? (
        <>
          <SettingsRow label="Selected connection">
            <div className="flex flex-wrap items-center gap-2" role="status">
              <Badge variant="secondary">
                {
                  {
                    gateway: "Gateway credits",
                    chatgpt: "ChatGPT subscription",
                    "claude-code": "Claude subscription",
                  }[data.activeProvider]
                }
              </Badge>
              {data.activeProvider !== "gateway" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => void save({ provider: "gateway" })}
                >
                  Use Gateway
                </Button>
              ) : null}
            </div>
          </SettingsRow>
          <SettingsRow label="OpenAI ChatGPT" hint="Personal subscription">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {data.chatgpt.configured ? "Saved" : "Sign-in file needed"}
              </Badge>
              {data.chatgpt.accountLabel ? (
                <span className="break-all text-sm text-muted-foreground">
                  {data.chatgpt.accountLabel}
                </span>
              ) : null}
              {data.chatgpt.configured && data.activeProvider !== "chatgpt" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => void save({ provider: "chatgpt" })}
                >
                  Use saved account
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || !data.chatgpt.configured}
                onClick={() => void disconnect("chatgpt")}
              >
                Disconnect
              </Button>
            </div>
          </SettingsRow>
          {data.chatgpt.lastError ? (
            <p role="alert" className="text-sm text-destructive">
              {data.chatgpt.lastError}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            On your computer, run the personal sign-in helper, then import its
            protected file below. This uses OpenAI's eligible-app preview.
            <code className="mt-2 block break-all text-xs">
              cd apps/web &amp;&amp; bun scripts/connect-chatgpt.ts --host-id{" "}
              {data.chatgpt.hostId}
            </code>
            <span className="mt-2 block break-all">
              File: ~/.config/deniz-dashboard/chatgpt-connection.json
            </span>
          </p>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                (credentials || data.chatgpt.configured) &&
                chatgptModel.trim()
              )
                void save({
                  provider: "chatgpt",
                  ...(credentials ? { credentials } : {}),
                  model: chatgptModel.trim(),
                });
            }}
          >
            <SettingsRow
              label="Sign-in file"
              htmlFor="chatgpt-credentials"
              hint="Personal sign-in · encrypted when saved"
              stacked
            >
              <Input
                id="chatgpt-credentials"
                type="file"
                accept=".json,application/json"
                className="w-full"
                ref={fileInput}
                disabled={disabled}
                onChange={(event) =>
                  void readCredentials(event.target.files?.[0])
                }
              />
            </SettingsRow>
            <SettingsRow label="ChatGPT model" htmlFor="chatgpt-model">
              <Select
                value={chatgptModel}
                disabled={disabled || (!models.length && !data.chatgpt.model)}
                onValueChange={setChatgptModel}
              >
                <SelectTrigger id="chatgpt-model" className="w-full">
                  <SelectValue placeholder="Load available models" />
                </SelectTrigger>
                <SelectContent>
                  {models.length ? (
                    models.map((model) => (
                      <SelectItem key={model.slug} value={model.slug}>
                        {model.display_name}
                      </SelectItem>
                    ))
                  ) : data.chatgpt.model ? (
                    <SelectItem value={data.chatgpt.model}>
                      {data.chatgpt.model}
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </SettingsRow>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={
                  disabled ||
                  (!credentials && !data.chatgpt.configured) ||
                  !chatgptModel.trim()
                }
              >
                {action === "chatgpt" ? <Spinner /> : null} Save and use ChatGPT
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  disabled || (!credentials && !data.chatgpt.configured)
                }
                onClick={() => void loadModels()}
              >
                Load models
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  void platform.openExternal(
                    "https://developers.openai.com/siwc/token-sharing-open-source",
                  )
                }
              >
                Sign-in help
              </Button>
            </div>
          </form>
          <SettingsRow label="Claude" hint="Personal subscription">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {data.claude.configured ? "Saved" : "Setup token needed"}
              </Badge>
              {data.claude.configured &&
              data.activeProvider !== "claude-code" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => void save({ provider: "claude-code" })}
                >
                  Use saved account
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || !data.claude.configured}
                onClick={() => void disconnect("claude-code")}
              >
                Disconnect
              </Button>
            </div>
          </SettingsRow>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                (token.trim() || data.claude.configured) &&
                claudeModel.trim()
              )
                void save({
                  provider: "claude-code",
                  ...(token.trim() ? { token: token.trim() } : {}),
                  model: claudeModel.trim(),
                });
            }}
          >
            <SettingsRow
              label={
                data.claude.configured ? "Replace setup token" : "Setup token"
              }
              htmlFor="claude-subscription-token"
              hint="From claude setup-token · encrypted when saved"
              stacked
            >
              <Input
                id="claude-subscription-token"
                className="w-full"
                type="password"
                value={token}
                disabled={disabled}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="new-password"
                spellCheck={false}
              />
            </SettingsRow>
            <SettingsRow
              label="Claude model"
              htmlFor="claude-subscription-model"
            >
              <Input
                id="claude-subscription-model"
                className="w-full"
                value={claudeModel}
                disabled={disabled}
                onChange={(event) => setClaudeModel(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </SettingsRow>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={
                  disabled ||
                  (!token.trim() && !data.claude.configured) ||
                  !claudeModel.trim()
                }
              >
                {action === "claude-code" ? <Spinner /> : null} Save and use
                Claude
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  void platform.openExternal(
                    "https://code.claude.com/docs/en/authentication",
                  )
                }
              >
                Setup help
              </Button>
            </div>
          </form>
        </>
      ) : null}
    </SettingsGroup>
  );
}
