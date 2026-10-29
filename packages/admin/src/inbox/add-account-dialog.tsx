"use client";

import type { IEmailAccount } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { SectionLabel } from "@repo/ui/section";
import { Switch } from "@repo/ui/switch";
import { FilterTabs } from "@repo/ui/toolbar";
import { ExternalLink, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
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
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean; requireTLS: boolean };
  setupLinks: { label: string; url: string }[];
  warning?: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    provider: "gmail",
    label: "Gmail",
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
    warning: "May require Modern Auth for SMTP",
  },
  {
    provider: "icloud",
    label: "iCloud",
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
  onAccountDeleted?: (accountId: string) => void | Promise<void>;
}

function SwitchField({
  id,
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex h-8 items-center justify-between gap-3 self-end">
      <label htmlFor={id} className="text-sm text-accent-strong">
        {label}
      </label>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function AddAccountDialog({
  open,
  onOpenChange,
  onAccountAdded,
  account,
  onAccountDeleted,
}: AddAccountDialogProps) {
  const { client, platform } = useAdmin();
  const idPrefix = useId();
  const fieldId = (name: keyof FormData) => `${idPrefix}-${name}`;
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      toast.success(account ? "Account saved" : "Account added");
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

  const handleDelete = async () => {
    if (!account) return;
    setDeleting(true);
    try {
      await client.del<{ message: string }>(`email-accounts/${account._id}`);
      toast.success("Account deleted");
      onOpenChange(false);
      await onAccountDeleted?.(account._id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
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
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={isEditing ? account?.displayName || account?.user : "Add account"}
      onSubmit={handleSubmit(onSubmit)}
      submitLabel={loading ? "Testing…" : isEditing ? "Save" : "Add"}
      pending={loading || deleting}
      footerStart={
        isEditing && account ? (
          <ConfirmButton
            trigger={
              <Button type="button" variant="ghost" disabled={loading}>
                <Trash2 />
                Delete
              </Button>
            }
            title={`Delete ${account.user}?`}
            description="Its stored mail is deleted with it."
            actionLabel="Delete"
            destructive
            onConfirm={handleDelete}
          />
        ) : null
      }
    >
      <FormField label="Provider" hint={selectedPreset?.warning}>
        <div className="flex flex-wrap items-center gap-2">
          <FilterTabs
            value={provider}
            onChange={(value) => {
              const preset = getProviderPreset(value);
              if (preset) handlePresetSelect(preset);
            }}
            options={PROVIDER_PRESETS.map((preset) => ({
              value: preset.provider,
              label: preset.label,
            }))}
          />
          {selectedPreset?.setupLinks.map((link) => (
            <Button
              key={link.url}
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => platform.openExternal(link.url)}
            >
              <ExternalLink />
              {link.label}
            </Button>
          ))}
        </div>
      </FormField>

      <FormGrid>
        <FormField label="Display name" htmlFor={fieldId("displayName")}>
          <Input
            id={fieldId("displayName")}
            placeholder="Work"
            {...register("displayName")}
          />
        </FormField>
        <FormField
          label="Address"
          htmlFor={fieldId("user")}
          error={errors.user?.message}
        >
          <Input
            id={fieldId("user")}
            type="email"
            placeholder="you@example.com"
            disabled={isEditing}
            {...register("user", {
              required: isEditing ? false : "Required",
            })}
          />
        </FormField>
      </FormGrid>

      <SectionLabel>IMAP</SectionLabel>
      <FormGrid>
        <FormField
          label="Password"
          htmlFor={fieldId("password")}
          error={errors.password?.message}
        >
          <Input
            id={fieldId("password")}
            type="password"
            placeholder={isEditing ? "••••••••" : "App password"}
            disabled={isEditing}
            {...register("password", {
              required: isEditing ? false : "Required",
            })}
          />
        </FormField>
        <FormField
          label="Mailbox"
          htmlFor={fieldId("inboxName")}
          error={errors.inboxName?.message}
        >
          <Input
            id={fieldId("inboxName")}
            disabled={isEditing}
            {...register("inboxName", {
              required: isEditing ? false : "Required",
            })}
          />
        </FormField>
        <FormField
          label="Host"
          htmlFor={fieldId("host")}
          error={errors.host?.message}
        >
          <Input
            id={fieldId("host")}
            placeholder="imap.example.com"
            disabled={isEditing}
            {...register("host", {
              required: isEditing ? false : "Required",
            })}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="Port"
            htmlFor={fieldId("port")}
            error={errors.port?.message}
          >
            <Input
              id={fieldId("port")}
              type="number"
              className="tabular-nums"
              disabled={isEditing}
              {...register("port", {
                valueAsNumber: true,
                required: isEditing ? false : "Required",
                min: { value: 1, message: "Invalid port" },
                max: { value: 65535, message: "Invalid port" },
              })}
            />
          </FormField>
          <SwitchField
            id={fieldId("secure")}
            label="SSL"
            checked={secure}
            disabled={isEditing}
            onCheckedChange={(checked) => setValue("secure", checked)}
          />
        </div>
      </FormGrid>

      <SectionLabel
        actions={
          <Switch
            id={fieldId("smtpEnabled")}
            aria-label="Send with SMTP"
            checked={smtpEnabled}
            onCheckedChange={(checked) => setValue("smtpEnabled", checked)}
          />
        }
      >
        SMTP
      </SectionLabel>
      {smtpEnabled ? (
        <FormGrid>
          <FormField label="Host" htmlFor={fieldId("smtpHost")}>
            <Input
              id={fieldId("smtpHost")}
              placeholder="smtp.example.com"
              {...register("smtpHost")}
            />
          </FormField>
          <div className="grid grid-cols-3 gap-4">
            <FormField
              label="Port"
              htmlFor={fieldId("smtpPort")}
              error={errors.smtpPort?.message}
            >
              <Input
                id={fieldId("smtpPort")}
                type="number"
                className="tabular-nums"
                {...register("smtpPort", {
                  valueAsNumber: true,
                  min: { value: 1, message: "Invalid port" },
                  max: { value: 65535, message: "Invalid port" },
                })}
              />
            </FormField>
            <SwitchField
              id={fieldId("smtpSecure")}
              label="SSL"
              checked={smtpSecure}
              onCheckedChange={(checked) => setValue("smtpSecure", checked)}
            />
            <SwitchField
              id={fieldId("smtpRequireTls")}
              label="TLS"
              checked={smtpRequireTls}
              onCheckedChange={(checked) => setValue("smtpRequireTls", checked)}
            />
          </div>
          <FormField label="From name" htmlFor={fieldId("smtpFromName")}>
            <Input
              id={fieldId("smtpFromName")}
              placeholder="Optional"
              {...register("smtpFromName")}
            />
          </FormField>
          <FormField label="From address" htmlFor={fieldId("smtpFromAddress")}>
            <Input
              id={fieldId("smtpFromAddress")}
              type="email"
              placeholder="Account address"
              {...register("smtpFromAddress")}
            />
          </FormField>
          <SwitchField
            id={fieldId("useSameCredentialsForSending")}
            label="IMAP credentials"
            checked={useSameCredentialsForSending}
            onCheckedChange={(checked) =>
              setValue("useSameCredentialsForSending", checked)
            }
          />
          <div className="hidden sm:block" />
          {!useSameCredentialsForSending ? (
            <>
              <FormField label="Username" htmlFor={fieldId("smtpUser")}>
                <Input
                  id={fieldId("smtpUser")}
                  type="email"
                  placeholder="sender@example.com"
                  {...register("smtpUser")}
                />
              </FormField>
              <FormField label="Password" htmlFor={fieldId("smtpPassword")}>
                <Input
                  id={fieldId("smtpPassword")}
                  type="password"
                  placeholder={isEditing ? "Unchanged" : ""}
                  {...register("smtpPassword")}
                />
              </FormField>
            </>
          ) : null}
        </FormGrid>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </FormDialog>
  );
}
