"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { DeploymentRows } from "../_components/deployment-rows";
import { useTarget } from "../_components/target-context";

const POLL_MS = 5_000;

export default function DeploymentsListPage() {
  const { target } = useTarget();
  const fetchDeployments = useCallback(
    () => api.deploy.deployments(target.id, { limit: 100 }),
    [target.id],
  );
  const { data, error, loading } = usePoll(fetchDeployments, POLL_MS);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data && loading) return <Skeleton className="h-64 w-full" />;

  return (
    <Section title="Deployments" count={data?.pagination.total}>
      <DeploymentRows deployments={data?.items ?? []} targetId={target.id} />
    </Section>
  );
}
