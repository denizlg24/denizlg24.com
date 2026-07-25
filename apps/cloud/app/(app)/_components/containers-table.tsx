"use client";

import { formatBytes, formatPercent } from "@repo/cloud-ui/format";
import type { ContainerSnapshot } from "@repo/schemas/cloud";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { RotateCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

function containerTone(state: string): StatusTone {
  if (state === "running") return "good";
  if (state === "restarting" || state === "paused") return "warning";
  if (state === "exited" || state === "dead") return "critical";
  return "muted";
}

function RestartButton({
  container,
  onDone,
}: {
  container: ContainerSnapshot;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const restart = async () => {
    setBusy(true);
    try {
      await api.ops.restartContainer(container.id);
      toast.success(`Restart queued: ${container.name}`);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={busy}
          aria-label={`Restart ${container.name}`}
        >
          <RotateCw className="size-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restart {container.name}?</AlertDialogTitle>
          <AlertDialogDescription>{container.image}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void restart()}>
            Restart
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ContainersTable({
  containers,
  onChanged,
}: {
  containers: ContainerSnapshot[];
  onChanged: () => void;
}) {
  const sorted = [...containers].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">containers</h2>
      <div className="overflow-x-auto border-y">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>name</TableHead>
              <TableHead>state</TableHead>
              <TableHead className="text-right">cpu</TableHead>
              <TableHead className="text-right">mem</TableHead>
              <TableHead className="text-right">net rx/tx</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((container) => (
              <TableRow key={container.id}>
                <TableCell className="max-w-56">
                  <div className="truncate text-sm">{container.name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {container.image}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5 text-xs">
                    <StatusDot tone={containerTone(container.state)} />
                    {container.state}
                    {container.health && (
                      <span className="text-muted-foreground">
                        · {container.health}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {formatPercent(container.cpuPercent)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {container.memoryBytes === null
                    ? "—"
                    : formatBytes(container.memoryBytes)}
                  {container.memoryPercent !== null && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatPercent(container.memoryPercent)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {container.networkRxBytes === null
                    ? "—"
                    : formatBytes(container.networkRxBytes)}
                  {" / "}
                  {container.networkTxBytes === null
                    ? "—"
                    : formatBytes(container.networkTxBytes)}
                </TableCell>
                <TableCell>
                  <RestartButton container={container} onDone={onChanged} />
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-16 text-center text-xs text-muted-foreground"
                >
                  —
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
