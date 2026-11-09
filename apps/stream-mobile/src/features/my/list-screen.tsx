import { router } from "expo-router";
import { Bookmark, CloudOff, Search } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useWatchlist } from "@/api/stream";
import {
  GridHeader,
  GridSkeleton,
  PosterGrid,
} from "@/features/browse/grid-screen";
import { useAudience } from "@/lib/audience-store";
import { Button, colors, EmptyState } from "@/ui";

/** Everything on the lead's list, newest first. */
export function ListScreen() {
  const { lead } = useAudience();
  const list = useWatchlist(lead.id);
  return (
    <View style={styles.screen}>
      <GridHeader title="My List" />
      <PosterGrid
        titles={list.data ?? []}
        empty={
          list.isPending ? (
            <GridSkeleton rows={4} />
          ) : list.isError ? (
            <EmptyState
              icon={CloudOff}
              title="My List didn't load"
              message="We couldn't reach Stream. Check your internet connection and try again."
              action={
                <Button label="Try again" onPress={() => void list.refetch()} />
              }
            />
          ) : (
            <EmptyState
              icon={Bookmark}
              title="Nothing saved yet"
              message="Tap My List on any film or series and it will wait for you here."
              action={
                <Button
                  label="Find something"
                  icon={Search}
                  variant="secondary"
                  onPress={() => router.push("/search")}
                />
              }
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
});
