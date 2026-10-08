"use client";

import { Button } from "@repo/ui/button";
import { Spinner } from "@repo/ui/spinner";
import { Check, EyeOff, RotateCcw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { ConfirmAction } from "@/components/confirm-action";
import type { ActionOutcome } from "@/lib/action-result";
import { resolveReportAction, setFoodRemovedAction } from "@/lib/actions";
import { plural } from "@/lib/format";

export function RestoreButton({
  itemId,
  size = "sm",
  onDone,
}: {
  itemId: string;
  size?: "sm" | "xs";
  onDone?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size={size}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setFoodRemovedAction(itemId, { removed: false });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Restored");
          onDone?.();
        })
      }
    >
      {pending ? <Spinner className="size-3.5" /> : <RotateCcw />}
      Restore
    </Button>
  );
}

export function RemoveFoodButton({
  itemId,
  name,
  label = "Remove",
  size = "sm",
  openReports = 0,
  onDone,
}: {
  itemId: string;
  name: string;
  label?: string;
  size?: "sm" | "xs";
  openReports?: number;
  onDone?: (reason: string | undefined) => void;
}) {
  async function remove(reason: string | undefined): Promise<ActionOutcome> {
    const result =
      openReports > 0
        ? await resolveReportAction(itemId, { action: "remove", reason })
        : await setFoodRemovedAction(itemId, { removed: true, reason });
    if (result.ok) onDone?.(reason);
    return result;
  }
  return (
    <ConfirmAction
      trigger={
        <Button variant="outline" size={size} className="text-danger">
          <EyeOff />
          {label}
        </Button>
      }
      title={`Remove “${name}”?`}
      description={
        openReports > 0 ? (
          <p>Closes {plural(openReports, "open report")}.</p>
        ) : undefined
      }
      confirmLabel="Remove food"
      destructive
      withReason
      successMessage="Food removed"
      onConfirm={remove}
    />
  );
}

export function CaseActions({
  itemId,
  name,
  openCount,
  removed,
  autoHidden,
}: {
  itemId: string;
  name: string;
  openCount: number;
  removed: boolean;
  autoHidden: boolean;
}) {
  const open = openCount > 0;
  const canRemove = !removed || (open && autoHidden);
  const canRestore = removed && !(open && autoHidden);
  return (
    <>
      {canRemove ? (
        <RemoveFoodButton
          itemId={itemId}
          name={name}
          label="Remove food"
          openReports={openCount}
        />
      ) : null}
      {open ? (
        <ConfirmAction
          trigger={
            <Button variant="outline" size="sm">
              <Check />
              Dismiss reports
            </Button>
          }
          title={`Dismiss ${plural(openCount, "open report")}?`}
          description={
            autoHidden ? <p>Restores the food to search.</p> : undefined
          }
          confirmLabel="Dismiss"
          withReason
          successMessage={
            autoHidden ? "Dismissed and restored" : "Reports dismissed"
          }
          onConfirm={(reason) =>
            resolveReportAction(itemId, { action: "dismiss", reason })
          }
        />
      ) : null}
      {canRestore ? <RestoreButton itemId={itemId} /> : null}
    </>
  );
}
