"use client";

import type { MacrosContributorRestriction } from "@repo/schemas/macros";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Label } from "@repo/ui/label";
import { Spinner } from "@repo/ui/spinner";
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { REASON_MAX } from "@/components/confirm-action";
import { Time } from "@/components/moderation";
import { setRestrictionAction } from "@/lib/actions";
import { formatCount, plural } from "@/lib/format";

export function RestrictionForm({
  userId,
  alias,
  restriction,
  visibleContributions,
  now,
}: {
  userId: string;
  alias: string;
  restriction: MacrosContributorRestriction;
  visibleContributions: number;
  now: number;
}) {
  const [sharingSuspended, setSharingSuspended] = useState(
    restriction.sharingSuspended,
  );
  const [suspended, setSuspended] = useState(restriction.suspended);
  const [reason, setReason] = useState(restriction.reason ?? "");
  const [removeContributions, setRemoveContributions] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const ids = {
    sharing: useId(),
    suspended: useId(),
    reason: useId(),
    remove: useId(),
  };

  const newlySuspended = suspended && !restriction.suspended;
  const removing = removeContributions && visibleContributions > 0;
  const dirty =
    sharingSuspended !== restriction.sharingSuspended ||
    suspended !== restriction.suspended ||
    reason.trim() !== (restriction.reason ?? "") ||
    removing;

  function save() {
    startTransition(async () => {
      const result = await setRestrictionAction(userId, {
        sharingSuspended,
        suspended,
        reason: reason.trim() || undefined,
        removeContributions: removing,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirming(false);
      setRemoveContributions(false);
      toast.success("Restriction saved");
    });
  }

  return (
    <>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (newlySuspended || removing) setConfirming(true);
          else save();
        }}
      >
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-4 border-b py-2.5">
            <Label htmlFor={ids.sharing} className="font-normal">
              Sharing suspended
            </Label>
            <Switch
              id={ids.sharing}
              checked={sharingSuspended}
              onCheckedChange={setSharingSuspended}
            />
          </div>
          <div className="flex items-center justify-between gap-4 border-b py-2.5">
            <Label htmlFor={ids.suspended} className="font-normal">
              Account suspended
            </Label>
            <Switch
              id={ids.suspended}
              checked={suspended}
              onCheckedChange={setSuspended}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label
            htmlFor={ids.reason}
            className="text-xs font-normal text-muted-foreground"
          >
            Reason
          </Label>
          <Textarea
            id={ids.reason}
            value={reason}
            maxLength={REASON_MAX}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-20 resize-none"
          />
        </div>
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={ids.remove}
            checked={removeContributions}
            disabled={visibleContributions === 0}
            onCheckedChange={(checked) =>
              setRemoveContributions(checked === true)
            }
            className="mt-0.5"
          />
          <Label
            htmlFor={ids.remove}
            className="flex-wrap text-sm leading-snug font-normal"
          >
            Also remove all their shared foods
            <span className="tabular-nums text-muted-foreground">
              {formatCount(visibleContributions)}
            </span>
          </Label>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {restriction.updatedAt ? (
              <>
                Updated <Time iso={restriction.updatedAt} now={now} />
              </>
            ) : null}
          </span>
          <Button type="submit" size="sm" disabled={!dirty || pending}>
            {pending && !confirming ? <Spinner className="size-3.5" /> : null}
            Save
          </Button>
        </div>
      </form>
      <AlertDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!pending) setConfirming(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base text-accent-strong">
              {newlySuspended ? (
                <>
                  Suspend <span className="font-mono">{alias}</span>?
                </>
              ) : (
                `Remove ${plural(visibleContributions, "shared food")}?`
              )}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="flex flex-col gap-1">
                {newlySuspended ? (
                  <li>Signs them out on every device.</li>
                ) : null}
                {removing ? (
                  <li>
                    Takes down {plural(visibleContributions, "shared food")}.
                  </li>
                ) : null}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={pending} onClick={save}>
              {pending ? <Spinner className="size-3.5" /> : null}
              {newlySuspended ? "Suspend" : "Remove"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
