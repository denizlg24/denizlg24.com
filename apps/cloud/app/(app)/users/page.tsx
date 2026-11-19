"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type {
  SafeUser,
  SignInLinkDelivery,
  SignInLinkDestination,
  SignInLinkIssued,
} from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { SecretValue } from "@repo/ui/secret-value";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { Mail, Plus, ShieldOff, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session-provider";
import { api, errorMessage, isApiError } from "@/lib/api";

function CreateUserDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"user" | "superuser">("user");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const reset = () => {
    setUsername("");
    setRole("user");
    setToken(null);
  };

  const create = async () => {
    setBusy(true);
    try {
      const created = await api.users.createPending({ username, role });
      setToken(created.signupToken);
      onCreated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-3.5" />
          pending user
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {token === null ? "Create pending user" : "Signup token"}
          </DialogTitle>
        </DialogHeader>
        {token === null ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-username" className="text-xs">
                Username
              </Label>
              <Input
                id="new-username"
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Role</Label>
              <Select
                value={role}
                onValueChange={(value) =>
                  setRole(value as "user" | "superuser")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="superuser">superuser</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={busy || username.trim().length === 0}
              onClick={() => void create()}
            >
              Create
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <SecretValue label="token — shown once" value={token} />
            <Button variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const AUTH_APP_DESTINATION = "auth";

function SignInLinkDialog({ user }: { user: SafeUser }) {
  const [open, setOpen] = useState(false);
  const [destinations, setDestinations] = useState<
    SignInLinkDestination[] | null
  >(null);
  const [destination, setDestination] = useState(AUTH_APP_DESTINATION);
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [copied, setCopied] = useState<SignInLinkIssued | null>(null);

  useEffect(() => {
    if (!open || destinations !== null) return;
    let active = true;
    void api.users
      .signInLinkDestinations()
      .then((found) => {
        if (active) setDestinations(found);
      })
      .catch((err: unknown) => {
        if (active) toast.error(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [open, destinations]);

  const reset = () => {
    setDestination(AUTH_APP_DESTINATION);
    setUnconfirmed(false);
    setCopied(null);
  };

  const send = async (delivery: SignInLinkDelivery) => {
    setBusy(true);
    try {
      const issued = await api.users.sendSignInLink({
        userId: user.id,
        delivery,
        confirmEmail: unconfirmed,
        ...(destination === AUTH_APP_DESTINATION
          ? {}
          : { returnTo: `${destination}/` }),
      });
      if (delivery === "copy") {
        setCopied(issued);
      } else {
        toast.success(`Sign-in link sent: ${issued.email}`);
        setOpen(false);
        reset();
      }
    } catch (err) {
      if (isApiError(err) && err.code === "EMAIL_NOT_VERIFIED") {
        setUnconfirmed(true);
      } else {
        toast.error(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Send ${user.username} a sign-in link`}
          disabled={user.status === "pending"}
        >
          <Mail className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign-in link · {user.username}</DialogTitle>
        </DialogHeader>
        {copied?.url ? (
          <div className="flex flex-col gap-4">
            <SecretValue label="link — shown once, 15 min" value={copied.url} />
            <Button variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Lands on</Label>
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTH_APP_DESTINATION}>
                    auth.denizlg24.com
                  </SelectItem>
                  {(destinations ?? []).map((option) => (
                    <SelectItem key={option.origin} value={option.origin}>
                      {option.name} · {new URL(option.origin).hostname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {unconfirmed ? (
              <p className="text-xs text-muted-foreground">
                {user.email ?? "address"} unconfirmed · sending marks it
                confirmed
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={busy}
                onClick={() => void send("email")}
              >
                Email
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                disabled={busy}
                onClick={() => void send("copy")}
              >
                Copy link
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UserRow({
  user,
  selfId,
  onChanged,
}: {
  user: SafeUser;
  selfId: string;
  onChanged: () => void;
}) {
  const removable = user.role !== "superuser";
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{user.username}</TableCell>
      <TableCell>
        <Badge
          variant={user.role === "superuser" ? "default" : "outline"}
          className="text-[10px]"
        >
          {user.role}
        </Badge>
      </TableCell>
      <TableCell>
        {user.status === "pending" ? (
          <Badge variant="secondary" className="text-[10px]">
            pending
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">active</span>
        )}
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot tone={user.totpEnabled ? "good" : "muted"} />
          {user.totpEnabled ? "totp" : "none"}
        </span>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {user.email ?? "—"}
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
        {formatRelative(user.createdAt)}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-0.5">
          <SignInLinkDialog user={user} />
          <ConfirmButton
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Reset MFA for ${user.username}`}
              >
                <ShieldOff className="size-3.5" />
              </Button>
            }
            title={`Reset MFA for ${user.username}?`}
            description="TOTP, recovery codes, and sessions are cleared; re-enrollment happens at next login."
            actionLabel="Reset MFA"
            onConfirm={async () => {
              try {
                await api.users.resetMfa(user.id);
                toast.success(`MFA reset: ${user.username}`);
                onChanged();
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          />
          <ConfirmButton
            trigger={
              <Button
                aria-label={`Delete ${user.username}`}
                variant="ghost"
                size="icon"
                className="size-7 text-destructive"
                disabled={!removable || user.id === selfId}
              >
                <Trash2 className="size-3.5" />
              </Button>
            }
            title={`Delete ${user.username}?`}
            actionLabel="Delete"
            onConfirm={async () => {
              try {
                await api.users.remove(user.id);
                toast.success(`Deleted: ${user.username}`);
                onChanged();
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function UsersPage() {
  const { user: self } = useSession();
  const fetchUsers = useCallback(() => api.users.list({ limit: 100 }), []);
  const { data, error, reload } = usePoll(fetchUsers, null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">
          users
          {data && (
            <span className="ml-2 font-normal text-muted-foreground">
              {data.pagination.total}
            </span>
          )}
        </h1>
        <CreateUserDialog onCreated={() => void reload()} />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!data ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto border-y">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>username</TableHead>
                <TableHead>role</TableHead>
                <TableHead>status</TableHead>
                <TableHead>mfa</TableHead>
                <TableHead>email</TableHead>
                <TableHead className="text-right">created</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  selfId={self.id}
                  onChanged={() => void reload()}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
