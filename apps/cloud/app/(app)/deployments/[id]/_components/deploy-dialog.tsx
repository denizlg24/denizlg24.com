"use client";

import type { DeployTarget } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { NativeSelect } from "@repo/ui/native-select";
import { Rocket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

/**
 * The SHA is optional and normally left blank — the control plane resolves the
 * ref through the GitHub App. It is still offered because without the App
 * installed the API refuses a ref with `GIT_SHA_REQUIRED`, and typing the
 * commit is then the only way through.
 */
export function DeployDialog({
  target,
  onDeployed,
}: {
  target: DeployTarget;
  onDeployed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState(target.productionBranch);
  const [sha, setSha] = useState("");
  const [kind, setKind] = useState<"production" | "preview">("production");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.deploy.create(target.id, {
        ref,
        kind,
        ...(sha.trim() ? { sha: sha.trim() } : {}),
      });
      toast.success(`Queued ${ref}`);
      setOpen(false);
      setSha("");
      onDeployed();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Rocket className="size-3" />
          Deploy
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deploy {target.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deploy-ref">Ref</Label>
            <Input
              id="deploy-ref"
              value={ref}
              onChange={(event) => setRef(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deploy-sha">Commit</Label>
            <Input
              id="deploy-sha"
              value={sha}
              placeholder="resolved from the ref"
              className="font-mono"
              onChange={(event) => setSha(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deploy-kind">Kind</Label>
            <NativeSelect
              id="deploy-kind"
              value={kind}
              onChange={(event) =>
                setKind(
                  event.target.value === "preview" ? "preview" : "production",
                )
              }
            >
              <option value="production">production</option>
              <option value="preview">preview</option>
            </NativeSelect>
          </div>
        </div>
        <DialogFooter>
          <Button
            size="sm"
            disabled={busy || ref.trim().length === 0}
            onClick={() => void submit()}
          >
            Deploy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
