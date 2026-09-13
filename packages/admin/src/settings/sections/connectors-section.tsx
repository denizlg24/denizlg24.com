"use client";

import {
  type Connector,
  type ConnectorApproval,
  type ConnectorAuth,
  type ConnectorAuthorizeResponse,
  type ConnectorDetail,
  type ConnectorOAuthClientInput,
  type ConnectorTool,
  connectorApprovalSchema,
  connectorSlugSchema,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { CopyButton } from "@repo/ui/copy-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { RadioGroup, RadioGroupItem } from "@repo/ui/radio-group";
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
import { Switch } from "@repo/ui/switch";
import { cn } from "@repo/ui/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { useConnectors } from "../../agent/use-connectors";
import { AdminApiError } from "../../client";
import { useAdmin } from "../../provider";
import { SettingsGroup } from "../settings-shell";
import {
  CONNECTOR_PRESETS,
  type ConnectorPreset,
  connectorIcon,
} from "./connector-presets";

const APPROVAL_LABEL: Record<ConnectorApproval, string> = {
  "reads-auto": "Reads run, writes ask",
  "always-ask": "Always ask",
  "never-ask": "Never ask",
};

const STATUS_TONE: Record<Connector["status"], StatusTone> = {
  ready: "good",
  "needs-auth": "warning",
  error: "critical",
  unconfigured: "muted",
};

const STATUS_LABEL: Record<Connector["status"], string> = {
  ready: "Ready",
  "needs-auth": "Needs auth",
  error: "Error",
  unconfigured: "Unconfigured",
};

function relativeTime(value: string | null): string | null {
  if (!value) return null;
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1_000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof AdminApiError || cause instanceof Error
    ? cause.message
    : fallback;
}

function toolFlags(tool: ConnectorTool): string {
  if (tool.actions) {
    const entries = Object.entries(tool.actions);
    const writes = entries.filter(([, flags]) => !flags.readOnly).length;
    return `${entries.length} actions · ${writes} write`;
  }
  if (tool.destructive) return "destructive";
  return tool.readOnly ? "read" : "write";
}

function ConnectorTools({
  connector,
  onChange,
}: {
  connector: Connector;
  onChange: (connector: Connector) => void;
}) {
  const { client } = useAdmin();
  const [tools, setTools] = useState<ConnectorTool[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .get<ConnectorDetail>(`connectors/${connector.id}`)
      .then((detail) => {
        if (!cancelled) setTools(detail.tools);
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client, connector.id]);

  const toggle = async (name: string, enabled: boolean) => {
    const disabledTools = enabled
      ? connector.disabledTools.filter((tool) => tool !== name)
      : [...connector.disabledTools, name];
    setSaving(name);
    try {
      const detail = await client.patch<ConnectorDetail>(
        `connectors/${connector.id}`,
        { disabledTools },
      );
      onChange(detail.connector);
      setTools(detail.tools);
    } catch (cause) {
      toast.error(errorText(cause, "Failed to update tool"));
    } finally {
      setSaving(null);
    }
  };

  if (!tools) {
    return (
      <div className="space-y-2 py-2">
        {[64, 48, 56].map((width) => (
          <Skeleton
            key={width}
            className="h-3"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    );
  }
  if (tools.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground">—</p>;
  }
  return (
    <ul className="divide-y divide-border/60">
      {tools.map((tool) => {
        const enabled = !connector.disabledTools.includes(tool.name);
        return (
          <li
            key={tool.name}
            className="flex min-w-0 items-center gap-3 py-1.5 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <span
                  className={cn(
                    "truncate font-mono text-[11px]",
                    !enabled && "text-muted-foreground line-through",
                  )}
                >
                  {tool.name}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {toolFlags(tool)}
                </span>
              </div>
              {tool.title || tool.description ? (
                <p className="truncate text-[11px] text-muted-foreground">
                  {tool.title ?? tool.description}
                </p>
              ) : null}
            </div>
            {saving === tool.name ? <Spinner className="size-3" /> : null}
            <Switch
              size="sm"
              checked={enabled}
              aria-label={`${enabled ? "Disable" : "Enable"} ${tool.name}`}
              disabled={saving !== null}
              onCheckedChange={(checked) => void toggle(tool.name, checked)}
            />
          </li>
        );
      })}
    </ul>
  );
}

interface OAuthClientDraft {
  clientId: string;
  clientSecret: string;
  scope: string;
}

const EMPTY_CLIENT: OAuthClientDraft = {
  clientId: "",
  clientSecret: "",
  scope: "",
};

function clientInput(
  draft: OAuthClientDraft,
): ConnectorOAuthClientInput | null {
  const clientId = draft.clientId.trim();
  if (!clientId) return null;
  const clientSecret = draft.clientSecret.trim();
  const scope = draft.scope.trim();
  return {
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    ...(scope ? { scope } : {}),
  };
}

/** Grid cells for a two-column parent. */
function OAuthClientFields({
  idPrefix,
  draft,
  onChange,
  redirectUrl,
  secretStored = false,
}: {
  idPrefix: string;
  draft: OAuthClientDraft;
  onChange: (draft: OAuthClientDraft) => void;
  redirectUrl: string | null;
  secretStored?: boolean;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-client-id`} className="text-xs">
          Client ID
        </Label>
        <Input
          id={`${idPrefix}-client-id`}
          value={draft.clientId}
          onChange={(event) =>
            onChange({ ...draft, clientId: event.target.value })
          }
          className="h-8 font-mono text-xs"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-client-secret`} className="text-xs">
          Client secret
        </Label>
        <Input
          id={`${idPrefix}-client-secret`}
          type="password"
          value={draft.clientSecret}
          onChange={(event) =>
            onChange({ ...draft, clientSecret: event.target.value })
          }
          placeholder={secretStored ? "••••••••" : undefined}
          className="h-8 font-mono text-xs"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-client-scope`} className="text-xs">
          Scope
        </Label>
        <Input
          id={`${idPrefix}-client-scope`}
          value={draft.scope}
          onChange={(event) =>
            onChange({ ...draft, scope: event.target.value })
          }
          className="h-8 font-mono text-xs"
          autoComplete="off"
        />
      </div>
      {redirectUrl ? (
        <div className="space-y-1 sm:col-span-2">
          <span className="text-xs font-medium">Redirect URL</span>
          <div className="flex min-w-0 items-center gap-1">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
              {redirectUrl}
            </code>
            <CopyButton value={redirectUrl} label="Copy redirect URL" />
          </div>
        </div>
      ) : null}
    </>
  );
}

function OAuthClientEditor({
  connector,
  redirectUrl,
  onChange,
}: {
  connector: Connector;
  redirectUrl: string | null;
  onChange: (connector: Connector) => void;
}) {
  const { client } = useAdmin();
  const [draft, setDraft] = useState<OAuthClientDraft>({
    clientId: connector.oauthClient?.clientId ?? "",
    clientSecret: "",
    scope: connector.oauthClient?.scope ?? "",
  });
  const [saving, setSaving] = useState(false);
  const input = clientInput(draft);

  const save = async (oauthClient: ConnectorOAuthClientInput | null) => {
    setSaving(true);
    try {
      const detail = await client.patch<ConnectorDetail>(
        `connectors/${connector.id}`,
        { oauthClient },
      );
      onChange(detail.connector);
      setDraft((current) =>
        oauthClient ? { ...current, clientSecret: "" } : EMPTY_CLIENT,
      );
    } catch (cause) {
      toast.error(errorText(cause, "Failed to update client"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (input) void save(input);
      }}
      className="grid gap-3 py-2 sm:grid-cols-2"
      aria-label={`${connector.name} OAuth client`}
    >
      <OAuthClientFields
        idPrefix={`connector-${connector.id}`}
        draft={draft}
        onChange={setDraft}
        redirectUrl={redirectUrl}
        secretStored={connector.oauthClient?.hasSecret ?? false}
      />
      <div className="flex items-center justify-end gap-1 sm:col-span-2">
        {connector.oauthClient ? (
          <Button
            type="button"
            variant="ghost"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            disabled={saving}
            onClick={() => void save(null)}
          >
            Remove
          </Button>
        ) : null}
        <Button
          type="submit"
          className="h-7 px-2.5 text-xs"
          disabled={!input || saving}
        >
          {saving ? <Spinner className="size-3" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}

function ConnectorRow({
  connector,
  oauthRedirectUrl,
  onChange,
  onRemove,
}: {
  connector: Connector;
  oauthRedirectUrl: string | null;
  onChange: (connector: Connector) => void;
  onRemove: (id: string) => void;
}) {
  const { client, platform } = useAdmin();
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<"tools" | "client" | null>(null);
  const Icon = connectorIcon(connector.url);
  const toggle = (panel: "tools" | "client") =>
    setExpanded((current) => (current === panel ? null : panel));

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } catch (cause) {
      toast.error(errorText(cause, `${label} failed`));
    } finally {
      setBusy(null);
    }
  };

  const patch = (body: Partial<Pick<Connector, "enabled" | "approval">>) =>
    run("Update", async () => {
      const detail = await client.patch<ConnectorDetail>(
        `connectors/${connector.id}`,
        body,
      );
      onChange(detail.connector);
    });

  const refresh = () =>
    run("Refresh", async () => {
      const detail = await client.post<ConnectorDetail>(
        `connectors/${connector.id}/refresh`,
      );
      onChange(detail.connector);
    });

  const authorize = () =>
    run("Authorize", async () => {
      const result = await client.post<ConnectorAuthorizeResponse>(
        `connectors/${connector.id}/authorize`,
      );
      if (result.status === "redirect") {
        await platform.openExternal(result.authorizationUrl);
        return;
      }
      const detail = await client.post<ConnectorDetail>(
        `connectors/${connector.id}/refresh`,
      );
      onChange(detail.connector);
    });

  const disconnect = () =>
    run("Disconnect", async () => {
      const result = await client.del<{ connector: Connector }>(
        `connectors/${connector.id}/authorize`,
      );
      onChange(result.connector);
    });

  const remove = () => {
    if (!window.confirm(`Delete ${connector.name}?`)) return;
    void run("Delete", async () => {
      await client.del(`connectors/${connector.id}`);
      onRemove(connector.id);
    });
  };

  const checked = relativeTime(connector.lastCheckedAt);

  return (
    <li className="space-y-2 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <StatusDot
          tone={connector.enabled ? STATUS_TONE[connector.status] : "muted"}
          label={STATUS_LABEL[connector.status]}
          className="mt-1.5"
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            {Icon ? (
              <Icon className="size-3.5 shrink-0 self-center" aria-hidden />
            ) : null}
            <span className="truncate text-sm font-medium">
              {connector.name}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {connector.slug}
            </span>
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {connector.url}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground tabular-nums">
            <span
              className={cn(connector.status === "error" && "text-destructive")}
            >
              {connector.statusDetail ?? STATUS_LABEL[connector.status]}
            </span>
            <span>·</span>
            <span>
              {connector.toolCount}{" "}
              {connector.toolCount === 1 ? "tool" : "tools"}
            </span>
            {checked ? (
              <>
                <span>·</span>
                <span>checked {checked}</span>
              </>
            ) : null}
          </p>
        </div>
        {busy ? <Spinner className="mt-1 size-3.5" /> : null}
        <Switch
          checked={connector.enabled}
          aria-label={`${connector.enabled ? "Disable" : "Enable"} ${connector.name}`}
          disabled={busy !== null}
          onCheckedChange={(enabled) => void patch({ enabled })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-5">
        <Select
          value={connector.approval}
          onValueChange={(value) => {
            const approval = connectorApprovalSchema.safeParse(value);
            if (approval.success) void patch({ approval: approval.data });
          }}
          disabled={busy !== null}
        >
          <SelectTrigger
            size="sm"
            className="h-7 w-auto gap-1.5 text-xs shadow-none"
            aria-label="Approval"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {connectorApprovalSchema.options.map((approval) => (
              <SelectItem key={approval} value={approval} className="text-xs">
                {APPROVAL_LABEL[approval]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={busy !== null}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
        {connector.auth === "oauth" ? (
          <>
            <Button
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={busy !== null}
              onClick={() => void authorize()}
            >
              Authorize
            </Button>
            {connector.hasSecret ? (
              <Button
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={busy !== null}
                onClick={() => void disconnect()}
              >
                Disconnect
              </Button>
            ) : null}
          </>
        ) : null}
        {connector.builtIn ? null : (
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            disabled={busy !== null}
            onClick={remove}
          >
            Delete
          </Button>
        )}
        <div className="ml-auto flex items-center">
          {connector.auth === "oauth" ? (
            <Button
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              aria-expanded={expanded === "client"}
              onClick={() => toggle("client")}
            >
              Client
              <ChevronRight
                className={cn(
                  "size-3 transition-transform",
                  expanded === "client" && "rotate-90",
                )}
              />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            aria-expanded={expanded === "tools"}
            onClick={() => toggle("tools")}
          >
            Tools
            <ChevronRight
              className={cn(
                "size-3 transition-transform",
                expanded === "tools" && "rotate-90",
              )}
            />
          </Button>
        </div>
      </div>
      {expanded === "tools" ? (
        <div className="ml-5 border-l pl-3">
          <ConnectorTools connector={connector} onChange={onChange} />
        </div>
      ) : expanded === "client" ? (
        <div className="ml-5 border-l pl-3">
          <OAuthClientEditor
            connector={connector}
            redirectUrl={oauthRedirectUrl}
            onChange={onChange}
          />
        </div>
      ) : null}
    </li>
  );
}

const AUTH_OPTIONS: Array<{
  value: Exclude<ConnectorAuth, "service">;
  label: string;
}> = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer token" },
  { value: "oauth", label: "OAuth" },
];

function AddConnectorForm({
  preset,
  oauthRedirectUrl,
  onCreated,
  onCancel,
}: {
  preset: ConnectorPreset | null;
  oauthRedirectUrl: string | null;
  onCreated: (connector: Connector) => void;
  onCancel: () => void;
}) {
  const { client } = useAdmin();
  const [slug, setSlug] = useState(preset?.slug ?? "");
  const [name, setName] = useState(preset?.name ?? "");
  const [url, setUrl] = useState(preset?.url ?? "");
  const [auth, setAuth] = useState<Exclude<ConnectorAuth, "service">>(
    preset?.auth ?? "none",
  );
  const [token, setToken] = useState("");
  const [oauthClient, setOAuthClient] = useState(EMPTY_CLIENT);
  const [clientOpen, setClientOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const clientRequired = auth === "oauth" && preset?.clientRequired === true;
  const slugValid = connectorSlugSchema.safeParse(slug).success;
  const urlValid = URL.canParse(url);
  const ready =
    slugValid &&
    name.trim().length > 0 &&
    urlValid &&
    (auth !== "bearer" || token.trim().length > 0) &&
    (!clientRequired || clientInput(oauthClient) !== null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    setSaving(true);
    const base = { slug, name: name.trim(), url: url.trim() };
    const registered = clientInput(oauthClient);
    try {
      const { connector } = await client.post<{ connector: Connector }>(
        "connectors",
        auth === "bearer"
          ? { ...base, auth, token: token.trim() }
          : auth === "oauth" && registered
            ? { ...base, auth, oauthClient: registered }
            : { ...base, auth },
      );
      onCreated(connector);
    } catch (cause) {
      toast.error(errorText(cause, "Failed to add connector"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 border-y py-4 sm:grid-cols-2"
      aria-label="Add connector"
    >
      <div className="space-y-1.5">
        <Label htmlFor="connector-slug" className="text-xs">
          Slug
        </Label>
        <Input
          id="connector-slug"
          value={slug}
          onChange={(event) => setSlug(event.target.value.toLowerCase())}
          aria-invalid={slug.length > 0 && !slugValid}
          className="h-8 font-mono text-xs"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="connector-name" className="text-xs">
          Name
        </Label>
        <Input
          id="connector-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-8 text-xs"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="connector-url" className="text-xs">
          URL
        </Label>
        <Input
          id="connector-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-invalid={url.length > 0 && !urlValid}
          placeholder="https://"
          className="h-8 font-mono text-xs"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <span className="text-xs font-medium">Auth</span>
        <div className="flex flex-wrap items-center gap-4">
          <RadioGroup
            value={auth}
            onValueChange={(value) => {
              const option = AUTH_OPTIONS.find(
                (entry) => entry.value === value,
              );
              if (option) setAuth(option.value);
            }}
            className="flex flex-wrap gap-4"
          >
            {AUTH_OPTIONS.map((option) => (
              <Label
                key={option.value}
                className="gap-1.5 text-xs font-normal"
                htmlFor={`connector-auth-${option.value}`}
              >
                <RadioGroupItem
                  id={`connector-auth-${option.value}`}
                  value={option.value}
                />
                {option.label}
              </Label>
            ))}
          </RadioGroup>
          {auth === "oauth" && !clientRequired ? (
            <Button
              type="button"
              variant="ghost"
              className="ml-auto h-7 gap-1 px-2 text-xs text-muted-foreground"
              aria-expanded={clientOpen}
              onClick={() => setClientOpen((current) => !current)}
            >
              Client
              <ChevronRight
                className={cn(
                  "size-3 transition-transform",
                  clientOpen && "rotate-90",
                )}
              />
            </Button>
          ) : null}
        </div>
      </div>
      {auth === "oauth" && (clientOpen || clientRequired) ? (
        <OAuthClientFields
          idPrefix="connector-new"
          draft={oauthClient}
          onChange={setOAuthClient}
          redirectUrl={oauthRedirectUrl}
        />
      ) : null}
      {auth === "bearer" ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="connector-token" className="text-xs">
            Token
          </Label>
          <Input
            id="connector-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="h-8 font-mono text-xs"
            autoComplete="off"
          />
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 sm:col-span-2">
        <Button
          type="button"
          variant="ghost"
          className="h-8 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-8 text-xs"
          disabled={!ready || saving}
        >
          {saving ? <Spinner className="size-3.5" /> : null}
          Add
        </Button>
      </div>
    </form>
  );
}

function useOAuthReturnNotice() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("connector");
    if (!value) return;
    const [kind, ...rest] = value.split(":");
    const detail = rest.join(":");
    if (kind === "authorized") toast.success(`Authorized ${detail}`);
    else if (kind === "denied") toast.error(`Authorization denied: ${detail}`);
    else if (kind === "failed") toast.error(`Authorization failed: ${detail}`);
    else toast.error("Authorization failed");
    params.delete("connector");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, []);
}

function AddConnectorMenu({
  connectors,
  onPick,
}: {
  connectors: Connector[];
  onPick: (preset: ConnectorPreset | null) => void;
}) {
  const taken = new Set(
    connectors.flatMap((connector) => [connector.slug, connector.url]),
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-7 gap-1 px-2.5 text-xs shadow-none"
        >
          Add
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem className="text-xs" onSelect={() => onPick(null)}>
          Custom
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {CONNECTOR_PRESETS.map((preset) => {
          const PresetIcon = preset.icon;
          return (
            <DropdownMenuItem
              key={preset.slug}
              className="text-xs"
              disabled={taken.has(preset.slug) || taken.has(preset.url)}
              onSelect={() => onPick(preset)}
            >
              <PresetIcon className="size-3.5" aria-hidden />
              {preset.name}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConnectorsSection() {
  const {
    connectors,
    oauthRedirectUrl,
    loading,
    error,
    refresh,
    replace,
    drop,
  } = useConnectors({ refreshOnFocus: true });
  const [adding, setAdding] = useState<{
    preset: ConnectorPreset | null;
  } | null>(null);
  useOAuthReturnNotice();

  return (
    <SettingsGroup
      label="Connectors"
      actions={
        adding ? null : (
          <AddConnectorMenu
            connectors={connectors ?? []}
            onPick={(preset) => setAdding({ preset })}
          />
        )
      }
    >
      {adding ? (
        <AddConnectorForm
          preset={adding.preset}
          oauthRedirectUrl={oauthRedirectUrl}
          onCancel={() => setAdding(null)}
          onCreated={(connector) => {
            replace(connector);
            setAdding(null);
          }}
        />
      ) : null}
      {loading ? (
        <div className="space-y-3">
          {[70, 55].map((width) => (
            <Skeleton
              key={width}
              className="h-4"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-xs text-destructive">
          {error}
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => void refresh()}
          >
            Retry
          </Button>
        </div>
      ) : (connectors ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="divide-y">
          {(connectors ?? []).map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              oauthRedirectUrl={oauthRedirectUrl}
              onChange={replace}
              onRemove={drop}
            />
          ))}
        </ul>
      )}
    </SettingsGroup>
  );
}
