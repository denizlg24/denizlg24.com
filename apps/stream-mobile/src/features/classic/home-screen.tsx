import { Popcorn } from "lucide-react-native";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useHome } from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { formatRemaining, progressFraction } from "@/lib/time";
import { Button, colors, EmptyState, gutter, spacing, Text } from "@/ui";
import { TitleRow } from "./title-row";

/** A few plainly labelled rows from `GET /home`: Continue watching, Picked for you, Films, Series. */
export function ClassicHomeScreen() {
  const { lead } = useAudience();
  const home = useHome(lead.id);
  const data = home.data;
  const rails = data?.rails.filter((rail) => rail.items.length > 0) ?? [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={home.isRefetching}
          onRefresh={() => void home.refetch()}
          tintColor={colors.muted}
        />
      }
    >
      <Text variant="classicTitle" style={styles.pad}>
        Hello, {lead.name}
      </Text>
      {home.isPending ? (
        <ActivityIndicator color={colors.muted} size="large" />
      ) : null}
      {home.isError && !data ? (
        <EmptyState
          large
          icon={Popcorn}
          title="This didn't load"
          message="We couldn't reach Stream. Check that you're connected to the internet, then try again."
          action={
            <Button
              label="Try again"
              size="classic"
              onPress={() => void home.refetch()}
            />
          }
        />
      ) : null}
      {data && rails.length === 0 ? (
        <EmptyState
          large
          icon={Popcorn}
          title="Nothing here yet"
          message="Films and series are still being added. Please check back a little later."
        />
      ) : null}
      {rails.map((rail) => (
        <View key={rail.id} style={styles.section}>
          <Text variant="classicHeading" color="amber" style={styles.pad}>
            {rail.label}
          </Text>
          {rail.kind === "continue"
            ? rail.items
                .slice(0, 6)
                .map((item) => (
                  <TitleRow
                    key={item.title.id}
                    title={item.title}
                    detail={formatRemaining(
                      item.progress.positionS,
                      item.progress.durationS,
                    )}
                    progress={progressFraction(
                      item.progress.positionS,
                      item.progress.durationS,
                    )}
                    episodeId={item.progress.episodeId}
                  />
                ))
            : rail.kind === "recommended"
              ? rail.items
                  .slice(0, 6)
                  .map((item) => (
                    <TitleRow
                      key={item.title.id}
                      title={item.title}
                      detail={item.reason}
                    />
                  ))
              : rail.items
                  .slice(0, 6)
                  .map((title) => <TitleRow key={title.id} title={title} />)}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl * 2,
    gap: spacing.lg,
  },
  pad: { paddingHorizontal: gutter },
  section: { gap: spacing.xs, marginTop: spacing.lg },
});
