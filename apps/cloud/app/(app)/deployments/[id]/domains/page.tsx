"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { Section } from "@repo/ui/section";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { DomainsPanel } from "../_components/domains-panel";
import { useTarget } from "../_components/target-context";

export default function DomainsPage() {
  const { target } = useTarget();
  // The hostname the platform assigned. It is not a `deploy_domains` row, so
  // the panel cannot read it from the list — and it is the one name that is
  // always live, which is exactly why it belongs on this page.
  const fetchLatest = useCallback(
    () => api.deploy.deployments(target.id, { limit: 1 }),
    [target.id],
  );
  const { data } = usePoll(fetchLatest, null);
  const autoHostname = data?.items[0]?.hostname ?? null;

  return (
    <Section title="Domains">
      <DomainsPanel targetId={target.id} autoHostname={autoHostname} />
    </Section>
  );
}
