"use client";

import { Section } from "@repo/ui/section";
import { DomainsPanel } from "../_components/domains-panel";
import { useTarget } from "../_components/target-context";

export default function DomainsPage() {
  const { target } = useTarget();
  return (
    <Section title="Domains">
      <DomainsPanel targetId={target.id} />
    </Section>
  );
}
