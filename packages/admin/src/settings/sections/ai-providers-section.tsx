"use client";

import {
  type AiProviderModels,
  type AiSubscriptionProvider,
  type ChatgptCredential,
  type ChatgptModelsResponse,
  chatgptCredentialSchema,
  type SaveAiSubscription,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { CopyButton } from "@repo/ui/copy-button";
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
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { ChevronDown, ExternalLink, RotateCcw } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../../provider";
import {
  authorizeVercel,
  disconnectAiSubscription,
  disconnectGateway,
  getChatgptModels,
  saveAiSubscription,
  saveGatewayConnection,
  testGatewayConnection,
} from "../ai-connections-api";
import { SettingsGroup } from "../settings-shell";
import type { AiProvidersState } from "../use-ai-providers";

const GATEWAY_SOURCE = {
  stored: "Saved key",
  environment: "Host key",
  oauth: "Vercel account",
} as const;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** One provider: status, account, default model and selection on one line. */
function ProviderRow({
  name,
  tone,
  detail,
  error,
  control,
  active,
  canActivate,
  activating,
  onActivate,
  expanded,
  onToggle,
  children,
}: {
  name: string;
  tone: StatusTone;
  detail: ReactNode;
  error?: string;
  control?: ReactNode;
  active: boolean;
  canActivate: boolean;
  activating: boolean;
  onActivate: () => void;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border/60 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusDot
          tone={tone}
          label={
            tone === "good"
              ? "Connected"
              : tone === "critical"
                ? "Error"
                : "Not connected"
          }
        />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 flex-col text-left"
        >
          <span className="text-sm text-accent-strong">{name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {detail}
          </span>
        </button>
        {control ? (
          <div className="order-last w-full sm:order-none sm:w-60">
            {control}
          </div>
        ) : null}
        {active ? (
          <Badge variant="good">Active</Badge>
        ) : (
          <Button
            variant="outline"
            size="xs"
            disabled={!canActivate || activating}
            onClick={onActivate}
          >
            {activating ? <Spinner /> : null}
            Use
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={expanded ? `Close ${name}` : `Manage ${name}`}
          onClick={onToggle}
        >
          <ChevronDown
            className={cn("transition-transform", expanded && "rotate-180")}
          />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 pl-5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {expanded ? (
        <div className="mt-3 flex flex-col gap-3 pl-5">{children}</div>
      ) : null}
    </div>
  );
}

function ModelPicker({
  entry,
  loading,
  disabled,
  onChange,
  label,
}: {
  entry: AiProviderModels | undefined;
  loading: boolean;
  disabled: boolean;
  onChange: (model: string) => void;
  label: string;
}) {
  if (loading && !entry?.models.length)
    return <Skeleton className="h-8 w-full" />;
  const models = entry?.models ?? [];
  const value = entry?.defaultModel ?? "";
  const listed = models.some((model) => model.id === value);
  return (
    <Select
      value={value}
      disabled={disabled || models.length === 0}
      onValueChange={onChange}
    >
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue placeholder="Model" />
      </SelectTrigger>
      <SelectContent>
        {value && !listed ? (
          <SelectItem value={value}>
            {value.split("/").slice(1).join("/")}
          </SelectItem>
        ) : null}
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            {model.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A single-line command with a copy affordance. */
function Command({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-1">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">
        {value}
      </code>
      <CopyButton value={value} label="Copy command" />
    </div>
  );
}

export function AiProvidersSection({ state }: { state: AiProvidersState }) {
  const { client, platform } = useAdmin();
  const { subscriptions, connections, providers, reload } = state;
  const [expanded, setExpanded] = useState<AiSubscriptionProvider | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const busy = useRef(false);

  const [claudeToken, setClaudeToken] = useState("");
  const [gatewayKey, setGatewayKey] = useState("");
  const [gatewayTeam, setGatewayTeam] = useState<string | null>(null);
  const [chatgptFile, setChatgptFile] = useState<{
    credentials: ChatgptCredential;
    models: ChatgptModelsResponse["models"];
    model: string;
  } | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function run(
    key: string,
    task: () => Promise<unknown>,
    done?: string,
  ): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setAction(key);
    try {
      await task();
      if (done) toast.success(done);
      return true;
    } catch (error) {
      toast.error(errorMessage(error, "Could not update the connection"));
      return false;
    } finally {
      busy.current = false;
      setAction(null);
    }
  }

  const save = (key: string, input: SaveAiSubscription, done?: string) =>
    run(key, () => saveAiSubscription(client, input), done);

  async function readChatgptFile(file: File | undefined) {
    setChatgptFile(null);
    if (!file) return;
    setReadingFile(true);
    try {
      if (file.size > 100_000) throw new Error("File too large");
      const credentials = chatgptCredentialSchema.parse(
        JSON.parse(await file.text()),
      );
      const { models } = await getChatgptModels(client, credentials);
      setChatgptFile({ credentials, models, model: models[0]?.slug ?? "" });
    } catch {
      if (fileInput.current) fileInput.current.value = "";
      toast.error("Not a valid ChatGPT connection file");
    } finally {
      setReadingFile(false);
    }
  }

  const toggle = (provider: AiSubscriptionProvider) =>
    setExpanded((current) => (current === provider ? null : provider));

  if (state.loading) {
    return (
      <SettingsGroup label="Providers">
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-10 w-full" />
          ))}
        </div>
      </SettingsGroup>
    );
  }

  if (state.failed || !subscriptions || !connections) {
    return (
      <SettingsGroup label="Providers">
        <div className="flex items-center gap-2" role="alert">
          <span className="text-sm text-muted-foreground">Unavailable</span>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      </SettingsGroup>
    );
  }

  const active = subscriptions.activeProvider;
  const entry = (provider: AiSubscriptionProvider) =>
    providers?.providers.find((item) => item.provider === provider);
  const disabled = action !== null;
  const gateway = connections.gateway;
  const team = gatewayTeam ?? gateway.teamIdOrSlug ?? "";
  const claude = entry("claude-code");
  const chatgpt = entry("chatgpt");
  const toneFor = (connected: boolean, error?: string): StatusTone =>
    !connected ? "muted" : error ? "critical" : "good";

  return (
    <SettingsGroup
      label="Providers"
      actions={
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh providers"
          disabled={disabled || state.providersLoading}
          onClick={() => void reload()}
        >
          {state.providersLoading ? <Spinner /> : <RotateCcw />}
        </Button>
      }
    >
      <div className="flex flex-col">
        <ProviderRow
          name="Claude"
          tone={toneFor(subscriptions.claude.configured, claude?.error)}
          detail={
            subscriptions.claude.configured ? "Subscription" : "Not connected"
          }
          error={claude?.error}
          control={
            subscriptions.claude.configured ? (
              <ModelPicker
                label="Claude model"
                entry={claude}
                loading={state.providersLoading}
                disabled={disabled}
                onChange={(model) =>
                  void save("claude-model", {
                    provider: "claude-code",
                    model,
                    activate: false,
                  })
                }
              />
            ) : null
          }
          active={active === "claude-code"}
          canActivate={subscriptions.claude.configured}
          activating={action === "claude-activate"}
          onActivate={() =>
            void save("claude-activate", { provider: "claude-code" })
          }
          expanded={expanded === "claude-code"}
          onToggle={() => toggle("claude-code")}
        >
          <Command value="claude setup-token" />
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const token = claudeToken.trim();
              if (!token) return;
              void save(
                "claude-token",
                {
                  provider: "claude-code",
                  token,
                  activate: !subscriptions.claude.configured,
                },
                subscriptions.claude.configured
                  ? "Token replaced"
                  : "Claude connected",
              ).then((ok) => {
                if (ok) setClaudeToken("");
              });
            }}
          >
            <Input
              type="password"
              className="min-w-0 flex-1"
              placeholder="sk-ant-oat…"
              aria-label="Setup token"
              value={claudeToken}
              disabled={disabled}
              onChange={(event) => setClaudeToken(event.target.value)}
              autoComplete="new-password"
              spellCheck={false}
            />
            <Button
              type="submit"
              size="sm"
              disabled={disabled || !claudeToken.trim()}
            >
              {action === "claude-token" ? <Spinner /> : null}
              {subscriptions.claude.configured ? "Replace" : "Connect"}
            </Button>
          </form>
          {subscriptions.claude.configured ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-destructive"
              disabled={disabled}
              onClick={() =>
                void run("claude-disconnect", () =>
                  disconnectAiSubscription(client, "claude-code"),
                )
              }
            >
              Disconnect
            </Button>
          ) : null}
        </ProviderRow>

        <ProviderRow
          name="ChatGPT"
          tone={toneFor(
            subscriptions.chatgpt.configured,
            subscriptions.chatgpt.lastError ?? chatgpt?.error,
          )}
          detail={
            subscriptions.chatgpt.configured
              ? (subscriptions.chatgpt.accountLabel ?? "Subscription")
              : "Not connected"
          }
          error={subscriptions.chatgpt.lastError ?? chatgpt?.error}
          control={
            subscriptions.chatgpt.configured ? (
              <ModelPicker
                label="ChatGPT model"
                entry={chatgpt}
                loading={state.providersLoading}
                disabled={disabled}
                onChange={(model) =>
                  void save("chatgpt-model", {
                    provider: "chatgpt",
                    model,
                    activate: false,
                  })
                }
              />
            ) : null
          }
          active={active === "chatgpt"}
          canActivate={subscriptions.chatgpt.configured}
          activating={action === "chatgpt-activate"}
          onActivate={() =>
            void save("chatgpt-activate", { provider: "chatgpt" })
          }
          expanded={expanded === "chatgpt"}
          onToggle={() => toggle("chatgpt")}
        >
          <Command
            value={`cd apps/web && bun scripts/connect-chatgpt.ts --host-id ${subscriptions.chatgpt.hostId}`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              aria-label="ChatGPT connection file"
              className="min-w-0 flex-1"
              disabled={disabled || readingFile}
              onChange={(event) =>
                void readChatgptFile(event.target.files?.[0])
              }
            />
            {readingFile ? <Spinner className="size-3" /> : null}
          </div>
          {chatgptFile ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!chatgptFile.model) return;
                void save(
                  "chatgpt-connect",
                  {
                    provider: "chatgpt",
                    credentials: chatgptFile.credentials,
                    model: chatgptFile.model,
                  },
                  "ChatGPT connected",
                ).then((ok) => {
                  if (!ok) return;
                  setChatgptFile(null);
                  if (fileInput.current) fileInput.current.value = "";
                });
              }}
            >
              <Select
                value={chatgptFile.model}
                onValueChange={(model) =>
                  setChatgptFile((current) =>
                    current ? { ...current, model } : current,
                  )
                }
              >
                <SelectTrigger
                  className="min-w-0 flex-1"
                  aria-label="ChatGPT model"
                >
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent>
                  {chatgptFile.models.map((model) => (
                    <SelectItem key={model.slug} value={model.slug}>
                      {model.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="submit"
                size="sm"
                disabled={disabled || !chatgptFile.model}
              >
                {action === "chatgpt-connect" ? <Spinner /> : null}
                Connect
              </Button>
            </form>
          ) : null}
          {subscriptions.chatgpt.configured ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-destructive"
              disabled={disabled}
              onClick={() =>
                void run("chatgpt-disconnect", async () => {
                  const result = await disconnectAiSubscription(
                    client,
                    "chatgpt",
                  );
                  if (result.revocationConfirmed === false)
                    toast.warning("Revoke the app in ChatGPT settings");
                })
              }
            >
              Disconnect
            </Button>
          ) : null}
        </ProviderRow>

        <ProviderRow
          name="Vercel AI Gateway"
          tone={
            gateway.status === "error"
              ? "critical"
              : gateway.configured
                ? "good"
                : "muted"
          }
          detail={
            gateway.configured
              ? [
                  gateway.source ? GATEWAY_SOURCE[gateway.source] : null,
                  gateway.teamIdOrSlug,
                  gateway.status === "unverified" ? "untested" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Not connected"
          }
          error={gateway.lastError}
          active={active === "gateway"}
          canActivate={gateway.configured}
          activating={action === "gateway-activate"}
          onActivate={() =>
            void save("gateway-activate", { provider: "gateway" })
          }
          expanded={expanded === "gateway"}
          onToggle={() => toggle("gateway")}
        >
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              const apiKey = gatewayKey.trim();
              if (!apiKey) return;
              void run(
                "gateway-save",
                async () => {
                  await saveGatewayConnection(client, {
                    apiKey,
                    teamIdOrSlug: team.trim() || undefined,
                  });
                  setGatewayKey("");
                  await reload();
                },
                "Gateway key saved",
              );
            }}
          >
            <Input
              className="sm:w-40"
              placeholder="Team (optional)"
              aria-label="Team ID or slug"
              value={team}
              disabled={disabled}
              onChange={(event) => setGatewayTeam(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Input
              type="password"
              className="min-w-0 flex-1"
              placeholder="API key"
              aria-label="Gateway API key"
              value={gatewayKey}
              disabled={disabled}
              onChange={(event) => setGatewayKey(event.target.value)}
              autoComplete="new-password"
              spellCheck={false}
            />
            <Button
              type="submit"
              size="sm"
              disabled={disabled || !gatewayKey.trim()}
            >
              {action === "gateway-save" ? <Spinner /> : null}
              {gateway.configured ? "Replace" : "Connect"}
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            {connections.vercelOAuthAvailable && client.endpointUrl ? (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  void run("gateway-oauth", async () => {
                    await platform.openExternal(authorizeVercel(client, team));
                  })
                }
              >
                <ExternalLink />
                Sign in with Vercel
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || !gateway.configured}
              onClick={() =>
                void run(
                  "gateway-test",
                  async () => {
                    try {
                      await testGatewayConnection(client);
                    } finally {
                      await reload();
                    }
                  },
                  "Gateway reachable",
                )
              }
            >
              {action === "gateway-test" ? <Spinner /> : null}
              Test
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={
                disabled ||
                !gateway.configured ||
                gateway.source === "environment"
              }
              onClick={() =>
                void run("gateway-disconnect", async () => {
                  await disconnectGateway(client);
                  await reload();
                })
              }
            >
              Disconnect
            </Button>
          </div>
        </ProviderRow>
      </div>
    </SettingsGroup>
  );
}
