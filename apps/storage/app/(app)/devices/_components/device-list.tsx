"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import type { SmbCredential } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session-provider";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/folder-cache";
import type { IssuedDevice } from "./add-device-wizard";
import { platformInfo } from "./platform";

const LIST_POLL_MS = 15_000;

function Status({ credential }: { credential: SmbCredential }) {
  if (credential.connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-status-good/10 px-2 py-0.5 text-xs text-status-good">
        <span className="size-1.5 rounded-full bg-status-good" />
        Connected now
        {credential.lastAuthenticatedFrom &&
          ` · ${credential.lastAuthenticatedFrom}`}
      </span>
    );
  }
  if (credential.lastAuthenticatedAt) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        Connected {formatRelative(credential.lastAuthenticatedAt)}
        {credential.lastAuthenticatedFrom &&
          ` · ${credential.lastAuthenticatedFrom}`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
      Never connected
    </span>
  );
}

/**
 * Every computer that can mount the drives, with what the host last saw of
 * it. "Show setup again" cannot show the old password — it was never kept —
 * so it issues a new one under the same name and reopens the drive step.
 */
export function DeviceList({
  onAdd,
  onResume,
}: {
  onAdd: () => void;
  onResume: (device: IssuedDevice) => void;
}) {
  const client = useQueryClient();
  const { user } = useSession();
  const superuser = user.role === "superuser";
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const owner = superuser && scope === "all" ? "all" : undefined;
  const devices = useQuery({
    queryKey: [...keys.devices, owner ?? "mine"],
    queryFn: () => api.smbCredentials.list(owner),
    refetchInterval: LIST_POLL_MS,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.smbCredentials.revoke(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.devices });
      toast.success("Device removed");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const reissue = useMutation({
    mutationFn: async (credential: SmbCredential) => {
      await api.smbCredentials.revoke(credential.id);
      return api.smbCredentials.issue({
        deviceName: credential.deviceName,
        platform: credential.platform ?? undefined,
      });
    },
    onSuccess: async (fresh, credential) => {
      await client.invalidateQueries({ queryKey: keys.devices });
      onResume({
        deviceName: fresh.deviceName,
        id: fresh.id,
        platform: credential.platform ?? "other",
        principal: fresh.principal,
        secret: fresh.secret,
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const busy = remove.isPending || reissue.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium">
          {owner ? "Everyone's computers" : "Your computers"}
        </h2>
        <div className="flex items-center gap-2">
          {superuser && (
            <SegmentedControl
              ariaLabel="Whose computers"
              value={scope}
              onValueChange={setScope}
              className="[&>button]:min-h-8 [&>button]:text-xs"
              options={[
                { label: "Mine", value: "mine" },
                { label: "Everyone's", value: "all" },
              ]}
            />
          )}
          <Button size="sm" className="h-8" onClick={onAdd}>
            <Plus className="size-4" />
            Add this computer
          </Button>
        </div>
      </div>

      {devices.isPending ? (
        <ul className="flex flex-col divide-y">
          {[0, 1].map((row) => (
            <li key={row} className="flex items-center gap-3 py-3">
              <Skeleton className="size-9 rounded-lg" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </li>
          ))}
        </ul>
      ) : devices.isError ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-destructive" role="alert">
            Couldn't load your devices: {errorMessage(devices.error)}
          </p>
          <Button variant="outline" onClick={() => void devices.refetch()}>
            Try again
          </Button>
        </div>
      ) : devices.data.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
          <MonitorSmartphone
            className="size-8 text-muted-foreground/70"
            strokeWidth={1.5}
          />
          <p className="text-sm font-medium">No computer is connected yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Add one and follow the steps — it takes a few minutes and you only
            do it once per computer.
          </p>
          <Button size="sm" className="mt-1" onClick={onAdd}>
            <Plus className="size-4" />
            Add this computer
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col divide-y">
          {devices.data.map((credential) => {
            const info = platformInfo(credential.platform);
            return (
              <li
                key={credential.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
              >
                <div
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/40"
                  title={info.label}
                >
                  <info.icon
                    className="size-4 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {credential.deviceName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {credential.ownerUsername &&
                      `${credential.ownerUsername} · `}
                    username{" "}
                    <span className="font-mono">{credential.principal}</span>
                  </p>
                </div>
                <Status credential={credential} />
                <div
                  className={cn(
                    "flex shrink-0 items-center gap-1",
                    busy && "pointer-events-none opacity-60",
                    credential.ownerUsername !== undefined &&
                      credential.ownerUsername !== user.username &&
                      "invisible",
                  )}
                >
                  <ConfirmButton
                    trigger={
                      <Button variant="ghost" size="sm" className="h-8">
                        Show setup again
                      </Button>
                    }
                    title={`Set up ${credential.deviceName} again?`}
                    description="The old password can't be shown, so this makes a new one — the computer will need it the next time it connects."
                    actionLabel="Make a new password"
                    onConfirm={() => reissue.mutate(credential)}
                  />
                  <ConfirmButton
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-destructive hover:text-destructive"
                      >
                        Remove
                      </Button>
                    }
                    title={`Remove ${credential.deviceName}?`}
                    description="That computer is disconnected and its password stops working. You can add it again any time."
                    actionLabel="Remove"
                    onConfirm={() => remove.mutate(credential.id)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
