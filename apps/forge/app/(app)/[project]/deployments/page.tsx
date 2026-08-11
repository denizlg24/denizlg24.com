"use client";

import { DeploymentRows } from "@repo/cloud-ui/deploy/deployment-rows";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback } from "react";
import { useTarget } from "@/components/target-context";
import { api } from "@/lib/api";

const POLL_MS = 5_000;

export default function ProjectDeploymentsPage() {
  const { target } = useTarget();
  const fetchDeployments = useCallback(
    () => api.deploy.deployments(target.id, { limit: 100 }),
    [target.id],
  );
  const { data, error, loading } = usePoll(fetchDeployments, POLL_MS);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data && loading) return <Skeleton className="h-64 w-full" />;

  return (
    <Section title="deployments" count={data?.pagination.total}>
      <DeploymentRows
        deployments={data?.items ?? []}
        deploymentHref={(deployment) => `/deployments/${deployment.id}`}
      />
    </Section>
  );
}
