"use client";

import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { TypedConfirmDialog } from "@repo/ui/typed-confirm-dialog";
import { ArrowUpRight, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { DeployDialog } from "./_components/deploy-dialog";
import { DeploymentsPanel } from "./_components/deployments-panel";
import { DomainsPanel } from "./_components/domains-panel";
import { EnvPanel } from "./_components/env-panel";
import { SettingsPanel } from "./_components/settings-panel";

export default function DeployTargetPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const targetId = params.id;
  const [refreshToken, setRefreshToken] = useState(0);

  const fetchTarget = useCallback(
    () => api.deploy.target(targetId),
    [targetId],
  );
  const {
    data: target,
    error,
    unreachable,
    loading,
    reload,
  } = usePoll(fetchTarget, null);

  if (unreachable) {
    return <Unreachable retrying={loading} onRetry={() => void reload()} />;
  }
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!target) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold leading-tight">
            {target.name}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {target.projectSlug} · {target.repoOwner}/{target.repoName} ·{" "}
            {target.productionBranch}
          </p>
        </div>
        {target.primaryHostname && (
          <Button asChild variant="outline" size="sm">
            <a
              href={`https://${target.primaryHostname}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {target.primaryHostname}
              <ArrowUpRight className="size-3" />
            </a>
          </Button>
        )}
        <DeployDialog
          target={target}
          onDeployed={() => setRefreshToken((token) => token + 1)}
        />
        <TypedConfirmDialog
          title={`Delete ${target.name}`}
          keyword={target.name}
          actionLabel="Delete"
          onConfirm={async () => {
            try {
              await api.deploy.removeTarget(target.id);
              toast.success("Target deleted");
              router.push("/deployments");
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
          trigger={
            <Button variant="ghost" size="sm">
              <Trash2 className="size-3" />
            </Button>
          }
        />
      </div>

      <Tabs defaultValue="deployments">
        <TabsList variant="line">
          <TabsTrigger value="deployments" className="text-xs">
            deployments
          </TabsTrigger>
          <TabsTrigger value="domains" className="text-xs">
            domains
          </TabsTrigger>
          <TabsTrigger value="environment" className="text-xs">
            environment
          </TabsTrigger>
          <TabsTrigger value="settings" className="text-xs">
            settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="deployments" className="pt-4">
          <DeploymentsPanel target={target} refreshToken={refreshToken} />
        </TabsContent>
        <TabsContent value="domains" className="pt-4">
          <DomainsPanel targetId={target.id} />
        </TabsContent>
        <TabsContent value="environment" className="pt-4">
          <EnvPanel targetId={target.id} />
        </TabsContent>
        <TabsContent value="settings" className="pt-4">
          <SettingsPanel target={target} onSaved={() => void reload()} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
