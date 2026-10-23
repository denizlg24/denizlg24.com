import type { ProfileLayout } from "@repo/schemas/stream";
import { type ReactNode, useMemo } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useMe } from "@/api/stream";
import { resolveAudience } from "@/lib/audience";
import {
  type Audience,
  AudienceContext,
  useAudienceIds,
} from "@/lib/audience-store";
import { memberStatus } from "@/lib/member-status";
import { colors } from "@/ui";
import { NotInvited } from "./not-invited";
import { Unavailable } from "./unavailable";
import { Welcome } from "./welcome";

/**
 * Signed in → in the family → set up → someone on the sofa. Hands the
 * navigator the lead's layout, or null while the sofa is empty.
 */
export function MemberGate({
  children,
}: {
  children: (layout: ProfileLayout | null) => ReactNode;
}) {
  const me = useMe();
  const stored = useAudienceIds();
  const status = memberStatus(me.data, me.error);
  const profiles = me.data?.profiles;

  const audience = useMemo<Audience | null>(() => {
    if (!profiles || stored === undefined) return null;
    const seated = resolveAudience(profiles, stored);
    const lead = seated[0];
    if (!lead) return null;
    return {
      audience: seated,
      lead,
      layout: lead.layout,
      key: seated.map((profile) => profile.id).join(","),
    };
  }, [profiles, stored]);

  if (status === "not-a-member") return <NotInvited />;
  if (status === "needs-setup") return <Welcome />;
  if (status === "unavailable") {
    return (
      <Unavailable retrying={me.isFetching} onRetry={() => void me.refetch()} />
    );
  }
  if (status === "loading" || stored === undefined || !me.data) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  return (
    <AudienceContext value={audience}>
      {children(audience?.layout ?? null)}
    </AudienceContext>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
  },
});
