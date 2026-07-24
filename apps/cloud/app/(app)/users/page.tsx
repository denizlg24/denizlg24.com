"use client";

import type { SafeUser } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { Plus, ShieldOff, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { SecretValue } from "@/components/secret-value";
import { useSession } from "@/components/session-provider";
import { StatusDot } from "@/components/status-dot";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

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
          <ConfirmButton
            trigger={
              <Button variant="ghost" size="icon" className="size-7">
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
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
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
                <TableHead className="w-20" />
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
