"use client";

import type { IEmailAccount } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { ResponsiveDialog } from "@repo/ui/responsive-dialog";
import { Switch } from "@repo/ui/switch";
import type { LucideIcon } from "lucide-react";
import {
  Cloud,
  ExternalLink,
  Info,
  Loader2,
  Mail,
  Settings,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useAdmin } from "../provider";

type Provider = "gmail" | "outlook" | "icloud" | "yahoo" | "custom";

interface FormData {
  provider: Provider;
  displayName: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  inboxName: string;
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpRequireTls: boolean;
  smtpUser: string;
  smtpPassword: string;
  useSameCredentialsForSending: boolean;
  smtpFromName: string;
  smtpFromAddress: string;
}

interface ProviderPreset {
  provider: Provider;
  label: string;
  icon: LucideIcon;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean; requireTLS: boolean };
  setupLinks: { label: string; url: string }[];
  warning?: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    provider: "gmail",
    label: "Gmail",
    icon: Mail,
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      requireTLS: false,
    },
    setupLinks: [
      {
        label: "App passwords",
        url: "https://support.google.com/accounts/answer/185833",
      },
    ],
  },
  {
    provider: "outlook",
    label: "Outlook",
    icon: Mail,
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: {
      host: "smtp-mail.outlook.com",
      port: 587,
      secure: false,
      requireTLS: true,
    },
    setupLinks: [
      {
        label: "SMTP settings",
        url: "https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040",
      },
    ],
    warning:
      "Some Outlook accounts require Modern Auth and may reject password SMTP.",
  },
  {
    provider: "icloud",
    label: "iCloud",
    icon: Cloud,
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: {
      host: "smtp.mail.me.com",
      port: 587,
      secure: false,
      requireTLS: true,
    },
    setupLinks: [],
  },
  {
    provider: "yahoo",
    label: "Yahoo",
    icon: Mail,
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: {
      host: "smtp.mail.yahoo.com",
      port: 465,
      secure: true,
      requireTLS: false,
    },
    setupLinks: [],
  },
  {
    provider: "custom",
    label: "Custom",
    icon: Settings,
    imap: { host: "", port: 993, secure: true },
    smtp: { host: "", port: 587, secure: false, requireTLS: true },
    setupLinks: [],
  },
];

const DEFAULT_FORM: FormData = {
  provider: "custom",
  displayName: "",
  host: "",
  port: 993,
  secure: true,
  user: "",
  password: "",
  inboxName: "INBOX",
  smtpEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpRequireTls: true,
  smtpUser: "",
  smtpPassword: "",
  useSameCredentialsForSending: true,
  smtpFromName: "",
  smtpFromAddress: "",
};

function getProviderPreset(provider: Provider) {
  return PROVIDER_PRESETS.find((preset) => preset.provider === provider);
}

function inferProvider(account: IEmailAccount): Provider {
  if (account.provider && account.provider !== "custom") {
    return account.provider as Provider;
  }

  const matchedPreset = PROVIDER_PRESETS.find(
    (preset) =>
      preset.provider !== "custom" &&
      (preset.imap.host === account.host ||
        preset.smtp.host === account.smtpHost),
  );

  return matchedPreset?.provider ?? "custom";
}

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccountAdded: (account?: IEmailAccount) => void | Promise<void>;
  account?: IEmailAccount | null;
}

export function AddAccountDialog({
  open,
  onOpenChange,
  onAccountAdded,
  account,
}: AddAccountDialogProps) {
  const { client, platform } = useAdmin();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEditing = Boolean(account);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: DEFAULT_FORM,
  });

  const provider = watch("provider");
  const secure = watch("secure");
  const smtpSecure = watch("smtpSecure");
  const smtpRequireTls = watch("smtpRequireTls");
  const smtpEnabled = watch("smtpEnabled");
  const useSameCredentialsForSending = watch("useSameCredentialsForSending");
  const selectedPreset = useMemo(() => getProviderPreset(provider), [provider]);

  const formDefaults = useMemo<FormData>(() => {
    if (!account) return DEFAULT_FORM;
    const accountProvider = inferProvider(account);
    const preset = getProviderPreset(accountProvider);
    const smtpConfigured = account.smtpConfigured ?? Boolean(account.smtpHost);
    return {
      provider: accountProvider,
      displayName: account.displayName ?? "",
      host: account.host,
      port: account.port,
      secure: account.secure,
      user: account.user,
      password: "",
      inboxName: account.inboxName,
      smtpEnabled: smtpConfigured,
      smtpHost: smtpConfigured
        ? (account.smtpHost ?? preset?.smtp.host ?? "")
        : "",
      smtpPort: smtpConfigured
        ? (account.smtpPort ?? preset?.smtp.port ?? 587)
        : 587,
      smtpSecure: smtpConfigured
        ? (account.smtpSecure ?? preset?.smtp.secure ?? false)
        : false,
      smtpRequireTls: smtpConfigured
        ? (account.smtpRequireTls ?? preset?.smtp.requireTLS ?? true)
        : true,
      smtpUser: account.smtpUser ?? "",
      smtpPassword: "",
      useSameCredentialsForSending: account.smtpPasswordSharedWithImap ?? true,
      smtpFromName: account.smtpFromName ?? "",
      smtpFromAddress: account.smtpFromAddress ?? "",
    };
  }, [account]);

  useEffect(() => {
    if (open) {
      reset(formDefaults);
      setError(null);
    }
  }, [formDefaults, open, reset]);

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setError(null);

    try {
      const payload = {
        provider: data.provider,
        displayName: data.displayName || undefined,
        ...(isEditing
          ? {}
          : {
              host: data.host,
              port: data.port,
              secure: data.secure,
              user: data.user,
              password: data.password,
              inboxName: data.inboxName,
            }),
        smtpEnabled: data.smtpEnabled,
        ...(data.smtpEnabled
          ? {
              smtpHost: data.smtpHost.trim(),
              smtpPort: data.smtpPort,
              smtpSecure: data.smtpSecure,
              smtpRequireTls: data.smtpRequireTls,
              useSameCredentialsForSending: data.useSameCredentialsForSending,
              smtpUser:
                data.useSameCredentialsForSending || !data.smtpUser
                  ? undefined
                  : data.smtpUser,
              smtpPassword:
                data.useSameCredentialsForSending || !data.smtpPassword
                  ? undefined
                  : data.smtpPassword,
              smtpFromName: data.smtpFromName || undefined,
              smtpFromAddress: data.smtpFromAddress || undefined,
            }
          : {}),
      };

      const result = account
        ? await client.patch<{ account: IEmailAccount }>(
            `email-accounts/${account._id}`,
            payload,
          )
        : await client.post<{ account: IEmailAccount }>(
            "email-accounts",
            payload,
          );
      toast.success(
        account ? "Account updated successfully" : "Account added successfully",
      );
      reset(DEFAULT_FORM);
      onOpenChange(false);
      await onAccountAdded(result.account);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save account");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (loading) return;
    if (!newOpen) {
      reset(formDefaults);
      setError(null);
    }
    onOpenChange(newOpen);
  };

  const handlePresetSelect = (preset: ProviderPreset) => {
    setValue("provider", preset.provider);
    if (!isEditing) {
      setValue("host", preset.imap.host);
      setValue("port", preset.imap.port);
      setValue("secure", preset.imap.secure);
    }
    setValue("smtpEnabled", Boolean(preset.smtp.host));
    setValue("smtpHost", preset.smtp.host);
    setValue("smtpPort", preset.smtp.port);
    setValue("smtpSecure", preset.smtp.secure);
    setValue("smtpRequireTls", preset.smtp.requireTLS);
    setValue("useSameCredentialsForSending", true);
    setValue("smtpUser", "");
    setValue("smtpPassword", "");
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={isEditing ? "Edit Email Account" : "Add Email Account"}
      description={
        isEditing
          ? "Update SMTP sending settings for this account."
          : "Connect inbox reading with IMAP and sending with SMTP."
      }
      className="sm:max-w-2xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Provider</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {PROVIDER_PRESETS.map((preset) => {
              const Icon = preset.icon;
              return (
                <Button
                  type="button"
                  key={preset.provider}
                  variant={provider === preset.provider ? "default" : "outline"}
                  size="sm"
                  className="justify-start gap-2 text-xs"
                  onClick={() => handlePresetSelect(preset)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {preset.label}
                </Button>
              );
            })}
          </div>
        </div>

        {selectedPreset?.setupLinks.length ? (
          <div className="flex flex-wrap gap-2">
            {selectedPreset.setupLinks.map((link) => (
              <Button
                key={link.url}
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => platform.openExternal(link.url)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {link.label}
              </Button>
            ))}
          </div>
        ) : null}

        {selectedPreset?.warning ? (
          <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{selectedPreset.warning}</p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="displayName" className="text-xs">
              Display Name
            </Label>
            <Input
              id="displayName"
              placeholder="Work"
              className="h-9 text-sm"
              {...register("displayName")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user" className="text-xs">
              Email Address
            </Label>
            <Input
              id="user"
              type="email"
              placeholder="you@example.com"
              className="h-9 text-sm"
              disabled={isEditing}
              {...register("user", {
                required: isEditing ? false : "Email is required",
              })}
            />
            {errors.user && (
              <p className="text-xs text-destructive">{errors.user.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-xs">
            IMAP Password
          </Label>
          <Input
            id="password"
            type="password"
            placeholder="App password or email password"
            className="h-9 text-sm"
            disabled={isEditing}
            {...register("password", {
              required: isEditing ? false : "Password is required",
            })}
          />
          {errors.password && (
            <p className="text-xs text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_110px_120px]">
          <div className="space-y-1.5">
            <Label htmlFor="host" className="text-xs">
              IMAP Host
            </Label>
            <Input
              id="host"
              placeholder="imap.gmail.com"
              className="h-9 text-sm"
              disabled={isEditing}
              {...register("host", {
                required: isEditing ? false : "Host is required",
              })}
            />
            {errors.host && (
              <p className="text-xs text-destructive">{errors.host.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="port" className="text-xs">
              IMAP Port
            </Label>
            <Input
              id="port"
              type="number"
              className="h-9 text-sm"
              disabled={isEditing}
              {...register("port", {
                valueAsNumber: true,
                required: isEditing ? false : "Port is required",
                min: { value: 1, message: "Invalid port" },
                max: { value: 65535, message: "Invalid port" },
              })}
            />
          </div>
          <div className="flex items-end justify-between gap-3 pb-2">
            <Label htmlFor="secure" className="text-xs">
              IMAP SSL
            </Label>
            <Switch
              id="secure"
              checked={secure}
              disabled={isEditing}
              onCheckedChange={(checked) => setValue("secure", checked)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <Label htmlFor="smtpEnabled" className="cursor-pointer text-xs">
            Enable SMTP sending
          </Label>
          <Switch
            id="smtpEnabled"
            checked={smtpEnabled}
            onCheckedChange={(checked) => setValue("smtpEnabled", checked)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_110px_120px]">
          <div className="space-y-1.5">
            <Label htmlFor="smtpHost" className="text-xs">
              SMTP Host
            </Label>
            <Input
              id="smtpHost"
              placeholder="smtp.gmail.com"
              className="h-9 text-sm"
              disabled={!smtpEnabled}
              {...register("smtpHost")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtpPort" className="text-xs">
              SMTP Port
            </Label>
            <Input
              id="smtpPort"
              type="number"
              className="h-9 text-sm"
              disabled={!smtpEnabled}
              {...register("smtpPort", {
                valueAsNumber: true,
                min: { value: 1, message: "Invalid port" },
                max: { value: 65535, message: "Invalid port" },
              })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 pb-2 sm:flex sm:items-end sm:justify-between">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="smtpSecure" className="text-xs">
                SSL
              </Label>
              <Switch
                id="smtpSecure"
                checked={smtpSecure}
                disabled={!smtpEnabled}
                onCheckedChange={(checked) => setValue("smtpSecure", checked)}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="smtpRequireTls" className="text-xs">
                TLS
              </Label>
              <Switch
                id="smtpRequireTls"
                checked={smtpRequireTls}
                disabled={!smtpEnabled}
                onCheckedChange={(checked) =>
                  setValue("smtpRequireTls", checked)
                }
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <Label
            htmlFor="useSameCredentialsForSending"
            className="cursor-pointer text-xs"
          >
            Use same credentials for sending
          </Label>
          <Switch
            id="useSameCredentialsForSending"
            checked={useSameCredentialsForSending}
            disabled={!smtpEnabled}
            onCheckedChange={(checked) =>
              setValue("useSameCredentialsForSending", checked)
            }
          />
        </div>

        {smtpEnabled && !useSameCredentialsForSending && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="smtpUser" className="text-xs">
                SMTP Username
              </Label>
              <Input
                id="smtpUser"
                type="email"
                placeholder="sender@example.com"
                className="h-9 text-sm"
                disabled={!smtpEnabled}
                {...register("smtpUser")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpPassword" className="text-xs">
                SMTP Password
              </Label>
              <Input
                id="smtpPassword"
                type="password"
                placeholder={isEditing ? "Leave blank to keep current" : ""}
                className="h-9 text-sm"
                disabled={!smtpEnabled}
                {...register("smtpPassword")}
              />
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="inboxName" className="text-xs">
              Inbox
            </Label>
            <Input
              id="inboxName"
              className="h-9 text-sm"
              disabled={isEditing}
              {...register("inboxName", {
                required: isEditing ? false : "Inbox name is required",
              })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtpFromName" className="text-xs">
              From Name
            </Label>
            <Input
              id="smtpFromName"
              placeholder="Optional"
              className="h-9 text-sm"
              disabled={!smtpEnabled}
              {...register("smtpFromName")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtpFromAddress" className="text-xs">
              From Email
            </Label>
            <Input
              id="smtpFromAddress"
              type="email"
              placeholder="Defaults to account"
              className="h-9 text-sm"
              disabled={!smtpEnabled}
              {...register("smtpFromAddress")}
            />
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            type="submit"
            disabled={loading}
            className="flex-1 text-xs"
            size="sm"
          >
            {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {loading
              ? "Testing connections..."
              : isEditing
                ? "Save Changes"
                : "Add Account"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
            size="sm"
            className="text-xs"
          >
            Cancel
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
