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
import { ConfirmButton, ConfirmDialog } from "@repo/ui/confirm-button";
import { CopyButton } from "@repo/ui/copy-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
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
import { Switch } from "@repo/ui/switch";
import { FilterTabs, RowActions } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  ChevronDown,
  ChevronRight,
  KeyRound,
  Plug,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unplug,
} from "lucide-react";
import { useEffect, useState } from "react";
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
      <div className="flex flex-col gap-2 py-2">
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
    return <EmptyState compact label="No tools" />;
  }
  return (
    <ul className="flex flex-col divide-y divide-border/70">
      {tools.map((tool) => {
        const enabled = !connector.disabledTools.includes(tool.name);
        return (
          <li
            key={tool.name}
            className="flex min-w-0 items-center gap-3 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <span
                  className={cn(
                    "truncate font-mono text-xs text-accent-strong",
                    !enabled && "text-muted-foreground line-through",
                  )}
                >
                  {tool.name}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {toolFlags(tool)}
                </span>
              </div>
              {tool.title || tool.description ? (
                <p className="truncate text-xs text-muted-foreground">
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

/** Cells for a two-column FormGrid. */
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
      <FormField label="Client ID" htmlFor={`${idPrefix}-client-id`}>
        <Input
          id={`${idPrefix}-client-id`}
          value={draft.clientId}
          onChange={(event) =>
            onChange({ ...draft, clientId: event.target.value })
          }
          className="font-mono"
          autoComplete="off"
        />
      </FormField>
      <FormField label="Client secret" htmlFor={`${idPrefix}-client-secret`}>
        <Input
          id={`${idPrefix}-client-secret`}
          type="password"
          value={draft.clientSecret}
          onChange={(event) =>
            onChange({ ...draft, clientSecret: event.target.value })
          }
          placeholder={secretStored ? "••••••••" : undefined}
          className="font-mono"
          autoComplete="off"
        />
      </FormField>
      <FormField
        label="Scope"
        htmlFor={`${idPrefix}-client-scope`}
        className="sm:col-span-2"
      >
        <Input
          id={`${idPrefix}-client-scope`}
          value={draft.scope}
          onChange={(event) =>
            onChange({ ...draft, scope: event.target.value })
          }
          className="font-mono"
          autoComplete="off"
        />
      </FormField>
      {redirectUrl ? (
        <FormField label="Redirect URL" className="sm:col-span-2">
          <div className="flex min-w-0 items-center gap-1">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {redirectUrl}
            </code>
            <CopyButton value={redirectUrl} label="Copy redirect URL" />
          </div>
        </FormField>
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
      className="flex flex-col gap-3 py-2"
      aria-label={`${connector.name} OAuth client`}
    >
      <FormGrid>
        <OAuthClientFields
          idPrefix={`connector-${connector.id}`}
          draft={draft}
          onChange={setDraft}
          redirectUrl={redirectUrl}
          secretStored={connector.oauthClient?.hasSecret ?? false}
        />
      </FormGrid>
      <div className="flex items-center justify-end gap-2">
        {connector.oauthClient ? (
          <ConfirmButton
            title="Remove OAuth client?"
            actionLabel="Remove"
            destructive
            onConfirm={() => save(null)}
            trigger={
              <Button type="button" variant="ghost" size="sm" disabled={saving}>
                Remove
              </Button>
            }
          />
        ) : null}
        <Button type="submit" size="sm" disabled={!input || saving}>
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

  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = () =>
    run("Delete", async () => {
      await client.del(`connectors/${connector.id}`);
      onRemove(connector.id);
    });

  const checked = relativeTime(connector.lastCheckedAt);

  const disclosure = (panel: "tools" | "client", label: string) => (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      aria-expanded={expanded === panel}
      onClick={() => toggle(panel)}
    >
      {label}
      <ChevronRight
        className={cn(
          "size-3 transition-transform",
          expanded === panel && "rotate-90",
        )}
      />
    </Button>
  );

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <StatusDot
          tone={connector.enabled ? STATUS_TONE[connector.status] : "muted"}
          label={STATUS_LABEL[connector.status]}
          className="mt-1.5"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            {Icon ? (
              <Icon
                className="size-3.5 shrink-0 self-center text-muted-foreground"
                aria-hidden
              />
            ) : null}
            <span className="truncate text-sm font-medium text-accent-strong">
              {connector.name}
            </span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {connector.slug}
            </span>
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {connector.url}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-muted-foreground">
            <span
              className={cn(
                connector.status === "error" && "text-status-critical",
              )}
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
                <span>{checked}</span>
              </>
            ) : null}
          </p>
        </div>
        {busy ? <Spinner className="mt-1.5 size-3.5" /> : null}
        <Switch
          checked={connector.enabled}
          aria-label={`${connector.enabled ? "Disable" : "Enable"} ${connector.name}`}
          disabled={busy !== null}
          onCheckedChange={(enabled) => void patch({ enabled })}
          className="mt-0.5"
        />
        <RowActions label={`${connector.name} actions`}>
          <DropdownMenuItem
            disabled={busy !== null}
            onSelect={() => void refresh()}
          >
            <RefreshCw /> Refresh
          </DropdownMenuItem>
          {connector.auth === "oauth" ? (
            <DropdownMenuItem
              disabled={busy !== null}
              onSelect={() => void authorize()}
            >
              <ShieldCheck /> Authorize
            </DropdownMenuItem>
          ) : null}
          {connector.auth === "oauth" && connector.hasSecret ? (
            <DropdownMenuItem
              disabled={busy !== null}
              onSelect={() => void disconnect()}
            >
              <Unplug /> Disconnect
            </DropdownMenuItem>
          ) : null}
          {connector.builtIn ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={busy !== null}
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          )}
        </RowActions>
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
          <SelectTrigger size="sm" className="w-auto" aria-label="Approval">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {connectorApprovalSchema.options.map((approval) => (
              <SelectItem key={approval} value={approval}>
                {APPROVAL_LABEL[approval]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center">
          {connector.auth === "oauth" ? disclosure("client", "Client") : null}
          {disclosure("tools", "Tools")}
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
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${connector.name}?`}
        actionLabel="Delete"
        destructive
        onConfirm={() => void remove()}
      />
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

function AddConnectorDialog({
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

  const submit = async () => {
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
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={preset ? `Add ${preset.name}` : "Add connector"}
      onSubmit={submit}
      submitLabel="Add"
      submitDisabled={!ready}
      pending={saving}
    >
      <FormGrid>
        <FormField label="Slug" htmlFor="connector-slug">
          <Input
            id="connector-slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
            aria-invalid={slug.length > 0 && !slugValid}
            className="font-mono"
            autoComplete="off"
            autoFocus
          />
        </FormField>
        <FormField label="Name" htmlFor="connector-name">
          <Input
            id="connector-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </FormField>
        <FormField
          label="URL"
          htmlFor="connector-url"
          className="sm:col-span-2"
        >
          <Input
            id="connector-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-invalid={url.length > 0 && !urlValid}
            placeholder="https://"
            className="font-mono"
            autoComplete="off"
          />
        </FormField>
        <FormField label="Auth" className="sm:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs
              value={auth}
              onChange={setAuth}
              options={AUTH_OPTIONS}
            />
            {auth === "oauth" && !clientRequired ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto text-muted-foreground"
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
        </FormField>
        {auth === "oauth" && (clientOpen || clientRequired) ? (
          <OAuthClientFields
            idPrefix="connector-new"
            draft={oauthClient}
            onChange={setOAuthClient}
            redirectUrl={oauthRedirectUrl}
          />
        ) : null}
        {auth === "bearer" ? (
          <FormField
            label="Token"
            htmlFor="connector-token"
            className="sm:col-span-2"
          >
            <Input
              id="connector-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="font-mono"
              autoComplete="off"
            />
          </FormField>
        ) : null}
      </FormGrid>
    </FormDialog>
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
        <Button variant="ghost" size="sm">
          <Plug /> Add
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => onPick(null)}>
          <KeyRound /> Custom
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {CONNECTOR_PRESETS.map((preset) => {
          const PresetIcon = preset.icon;
          return (
            <DropdownMenuItem
              key={preset.slug}
              disabled={taken.has(preset.slug) || taken.has(preset.url)}
              onSelect={() => onPick(preset)}
            >
              <PresetIcon aria-hidden />
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
        <AddConnectorMenu
          connectors={connectors ?? []}
          onPick={(preset) => setAdding({ preset })}
        />
      }
    >
      {adding ? (
        <AddConnectorDialog
          key={adding.preset?.slug ?? "custom"}
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
        <div className="flex flex-col gap-3">
          {[70, 55].map((width) => (
            <Skeleton
              key={width}
              className="h-4"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          compact
          label={<span className="text-status-critical">{error}</span>}
          action={
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : (connectors ?? []).length === 0 ? (
        <EmptyState compact icon={<Plug />} label="No connectors" />
      ) : (
        <ul className="flex flex-col divide-y divide-border/70">
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
