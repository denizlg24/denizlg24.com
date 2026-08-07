"use client";

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
import { Section } from "@repo/ui/section";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { TargetGrid } from "@/components/deploy/target-grid";
import { api, errorMessage } from "@/lib/api";

/**
 * The rest of the target's configuration lives on its own page. Asking for the
 * repository and the name is the whole of what cannot be defaulted — builder,
 * commands and limits all have working defaults, and the hostname follows from
 * the project slug.
 */
function CreateTargetDialog({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("web");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const [repoOwner, repoName] = repo.split("/");
    if (!repoOwner || !repoName) {
      toast.error("Repository must be owner/name");
      return;
    }
    setBusy(true);
    try {
      const created = await api.deploy.createTarget({
        projectId,
        name,
        repoOwner,
        repoName,
        productionBranch: branch,
        builder: "auto",
        healthPath: "/",
        memoryLimitMb: 512,
        cpuLimit: 1,
        autoDeploy: true,
        previewDeploys: true,
      });
      toast.success(`Created ${created.name}`);
      setOpen(false);
      onCreated();
      router.push(`/deployments/${created.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-3" />
          New target
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New deploy target</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="target-name">Name</Label>
            <Input
              id="target-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="target-repo">Repository</Label>
            <Input
              id="target-repo"
              value={repo}
              placeholder="denizlg24/site"
              className="font-mono"
              onChange={(event) => setRepo(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="target-branch">Production branch</Label>
            <Input
              id="target-branch"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            size="sm"
            disabled={busy || name.trim().length === 0}
            onClick={() => void submit()}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeploySection({ projectId }: { projectId: string }) {
  const [refreshToken, setRefreshToken] = useState(0);
  return (
    <Section
      title="Deployments"
      actions={
        <CreateTargetDialog
          projectId={projectId}
          onCreated={() => setRefreshToken((token) => token + 1)}
        />
      }
    >
      <TargetGrid key={refreshToken} projectId={projectId} />
    </Section>
  );
}
