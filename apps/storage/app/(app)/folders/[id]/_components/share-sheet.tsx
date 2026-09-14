"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import type {
  ShareExpiresIn,
  StorageShare,
  UpdateShareInput,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { CopyButton, useCopy } from "@repo/ui/copy-button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Switch } from "@repo/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/folder-cache";
import {
  EXPIRY_OPTIONS,
  expiryLabel,
  forgetShareLink,
  isLive,
  opensLabel,
  rememberedShareLink,
  rememberShareLink,
  shareUrl,
} from "@/lib/shares";

export interface ShareTarget {
  kind: "file" | "folder";
  id: string;
  name: string;
}

type Access = "download" | "view";

const PASSWORD_MIN = 4;

/**
 * One sheet for sharing a file or a folder. With no live link yet, the
 * choices are made and "Copy link" makes the link in the same click. With
 * one, the same fields edit it, and the link can be copied again from this
 * browser or stopped for everyone.
 */
export function ShareSheet({ target }: { target: ShareTarget }) {
  const [stopped, setStopped] = useState(false);
  const shares = useQuery({
    queryKey: keys.shares,
    queryFn: () => api.shares.list(),
    staleTime: 30_000,
  });
  const existing =
    shares.data?.find(
      (share) =>
        share.kind === target.kind &&
        share.targetId === target.id &&
        isLive(share),
    ) ?? null;

  if (shares.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-28" />
      </div>
    );
  }
  if (shares.isError) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-destructive" role="alert">
          Couldn't check whether this is already shared:{" "}
          {errorMessage(shares.error)}
        </p>
        <Button
          variant="outline"
          className="self-start"
          onClick={() => void shares.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }
  return existing ? (
    <EditShare
      key={existing.id}
      target={target}
      share={existing}
      onStopped={() => setStopped(true)}
    />
  ) : (
    <CreateShare
      target={target}
      notice={
        stopped ? "Sharing stopped. The old link no longer works." : undefined
      }
    />
  );
}

function AccessField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: Access;
  onChange: (value: Access) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
        <Label htmlFor={id} className="text-sm">
          Anyone with the link can
        </Label>
        <Select
          value={value}
          onValueChange={(next) =>
            onChange(next === "view" ? "view" : "download")
          }
          disabled={disabled}
        >
          <SelectTrigger id={id} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="download">View and download</SelectItem>
            <SelectItem value="view">View only</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {value === "view" && (
        <p className="text-xs text-muted-foreground">
          Hides the download buttons. People can still take screenshots.
        </p>
      )}
    </div>
  );
}

function ExpiryField({
  id,
  value,
  onChange,
  current,
  disabled,
}: {
  id: string;
  value: ShareExpiresIn | "";
  onChange: (value: ShareExpiresIn) => void;
  /** An existing link's expiry, shown until a new one is picked. */
  current?: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
      <Label htmlFor={id} className="text-sm">
        Link expires
      </Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as ShareExpiresIn)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-44">
          <SelectValue placeholder={current} />
        </SelectTrigger>
        <SelectContent>
          {EXPIRY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {current ? `In ${option.label.toLowerCase()}` : option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PasswordField({
  id,
  enabled,
  onEnabledChange,
  value,
  onChange,
  hasStored,
  disabled,
}: {
  id: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  /** The link already has a password this browser cannot show. */
  hasStored?: boolean;
  disabled?: boolean;
}) {
  const short = enabled && value.length > 0 && value.length < PASSWORD_MIN;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
        <Label htmlFor={`${id}-switch`} className="text-sm">
          Password
        </Label>
        <Switch
          id={`${id}-switch`}
          checked={enabled}
          onCheckedChange={onEnabledChange}
          disabled={disabled}
        />
      </div>
      {enabled && (
        <>
          <Input
            id={id}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={
              hasStored ? "Keep the current password" : "Choose a password"
            }
            aria-invalid={short || undefined}
            aria-describedby={`${id}-hint`}
            disabled={disabled}
          />
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {short
              ? `At least ${PASSWORD_MIN} characters.`
              : hasStored
                ? "Type a new password to change it. You'll need to tell people yourself — it isn't in the link."
                : "You'll need to tell people the password yourself — it isn't in the link."}
          </p>
        </>
      )}
    </div>
  );
}

function LinkRow({
  link,
  copied,
  failed,
  note,
}: {
  link: string;
  copied: boolean;
  failed: boolean;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <input
          readOnly
          value={link}
          aria-label="Share link"
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-sm outline-none"
        />
        <CopyButton value={link} label="Copy share link" />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Open link"
          asChild
        >
          <a href={link} target="_blank" rel="noreferrer noopener">
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {copied && <Check className="size-3.5 text-status-good" />}
        {copied ? "Copied. " : ""}
        {note}
      </p>
      {failed && (
        <p className="text-sm text-destructive" role="alert">
          Couldn't copy automatically — select the link and copy it yourself.
        </p>
      )}
    </div>
  );
}

function CreateShare({
  target,
  notice,
}: {
  target: ShareTarget;
  notice?: string;
}) {
  const id = useId();
  const client = useQueryClient();
  const [access, setAccess] = useState<Access>("download");
  const [expiry, setExpiry] = useState<ShareExpiresIn>("7d");
  const [passwordOn, setPasswordOn] = useState(false);
  const [password, setPassword] = useState("");
  const { copied, failed, copy } = useCopy(2_000);

  const create = useMutation({
    mutationFn: () =>
      api.shares.create(target, {
        allowDownload: access === "download",
        expiresIn: expiry,
        password: passwordOn ? password : undefined,
      }),
    onSuccess: async ({ token, share }) => {
      if (share) rememberShareLink(share.id, token);
      await copy(shareUrl(token));
      await client.invalidateQueries({ queryKey: keys.shares });
    },
  });
  const passwordInvalid = passwordOn && password.length < PASSWORD_MIN;
  const busy = create.isPending;

  return (
    <div className="flex flex-col gap-5">
      {notice && (
        <p className="text-sm text-foreground" role="status">
          {notice}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Make a link to{" "}
        <span className="font-medium text-foreground">{target.name}</span>
        {target.kind === "folder" ? " and everything in it" : ""}. Send it in a
        message, an email, wherever you like.
      </p>
      <AccessField
        id={`${id}-access`}
        value={access}
        onChange={setAccess}
        disabled={busy}
      />
      <ExpiryField
        id={`${id}-expiry`}
        value={expiry}
        onChange={setExpiry}
        disabled={busy}
      />
      <PasswordField
        id={`${id}-password`}
        enabled={passwordOn}
        onEnabledChange={setPasswordOn}
        value={password}
        onChange={setPassword}
        disabled={busy}
      />
      {create.data ? (
        <LinkRow
          link={shareUrl(create.data.token)}
          copied={copied}
          failed={failed}
          note={
            expiry === "never"
              ? "This link never expires."
              : `This link stops working in ${EXPIRY_OPTIONS.find((option) => option.value === expiry)?.label.toLowerCase()}.`
          }
        />
      ) : (
        <Button
          onClick={() => create.mutate()}
          disabled={busy || passwordInvalid}
          className="self-start"
        >
          {busy ? "Making link…" : "Copy link"}
        </Button>
      )}
      {create.isError && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage(create.error)}
        </p>
      )}
    </div>
  );
}

function EditShare({
  target,
  share,
  onStopped,
}: {
  target: ShareTarget;
  share: StorageShare;
  onStopped: () => void;
}) {
  const id = useId();
  const client = useQueryClient();
  const [access, setAccess] = useState<Access>(
    share.allowDownload ? "download" : "view",
  );
  const [expiry, setExpiry] = useState<ShareExpiresIn | "">("");
  const [passwordOn, setPasswordOn] = useState(share.hasPassword);
  const [password, setPassword] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const { copied, failed, copy } = useCopy(2_000);

  useEffect(() => {
    setLink(rememberedShareLink(share.id));
  }, [share.id]);

  const update = useMutation({
    mutationFn: (input: UpdateShareInput) => api.shares.update(share.id, input),
    onSuccess: async (result, input) => {
      if (result.token) {
        rememberShareLink(share.id, result.token);
        setLink(shareUrl(result.token));
        await copy(shareUrl(result.token));
      }
      if (input.revoke) {
        forgetShareLink(share.id);
        onStopped();
      }
      await client.invalidateQueries({ queryKey: keys.shares });
    },
  });

  const changes: UpdateShareInput = {};
  if ((access === "download") !== share.allowDownload) {
    changes.allowDownload = access === "download";
  }
  if (expiry !== "") changes.expiresIn = expiry;
  if (!passwordOn && share.hasPassword) changes.password = null;
  if (passwordOn && password.length > 0) changes.password = password;
  const dirty = Object.keys(changes).length > 0;
  const passwordInvalid =
    passwordOn && password.length > 0 && password.length < PASSWORD_MIN;
  const passwordMissing = passwordOn && !share.hasPassword && password === "";
  const busy = update.isPending;

  const save = () => {
    update.mutate(changes, {
      onSuccess: () => {
        setExpiry("");
        setPassword("");
      },
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{target.name}</span> is
        shared. Shared {formatRelative(share.createdAt)} · {opensLabel(share)}.
      </p>
      <AccessField
        id={`${id}-access`}
        value={access}
        onChange={setAccess}
        disabled={busy}
      />
      <ExpiryField
        id={`${id}-expiry`}
        value={expiry}
        onChange={setExpiry}
        current={expiryLabel(share)}
        disabled={busy}
      />
      <PasswordField
        id={`${id}-password`}
        enabled={passwordOn}
        onEnabledChange={setPasswordOn}
        value={password}
        onChange={setPassword}
        hasStored={share.hasPassword}
        disabled={busy}
      />

      {dirty ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={save}
            disabled={busy || passwordInvalid || passwordMissing}
          >
            {busy ? "Saving…" : "Save changes"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setAccess(share.allowDownload ? "download" : "view");
              setExpiry("");
              setPasswordOn(share.hasPassword);
              setPassword("");
            }}
          >
            Cancel
          </Button>
        </div>
      ) : link ? (
        <LinkRow
          link={link}
          copied={copied}
          failed={failed}
          note={`${expiryLabel(share)}.`}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            The link was made on another device, so it can't be shown here.
            Getting a new one replaces it — the old link stops working.
          </p>
          <Button
            variant="outline"
            className="self-start"
            disabled={busy}
            onClick={() => update.mutate({ rotate: true })}
          >
            {busy ? "Making link…" : "Get a new link"}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <p className="text-sm text-muted-foreground">
          Stopping removes the link for everyone who has it.
        </p>
        <Button
          variant="outline"
          className="shrink-0 text-destructive hover:text-destructive"
          disabled={busy}
          onClick={() => update.mutate({ revoke: true })}
        >
          Stop sharing
        </Button>
      </div>

      {update.isError && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage(update.error)}
        </p>
      )}
    </div>
  );
}
