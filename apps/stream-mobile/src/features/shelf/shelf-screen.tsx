import { router } from "expo-router";
import { Bookmark, CircleCheck, Clock, Settings } from "lucide-react-native";
import { useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useHighlights, useTonight, useWatchlist } from "@/api/stream";
import { openTitle, playTitle } from "@/features/studio/open";
import { StudioHeader } from "@/features/studio/studio-header";
import { useAudience } from "@/lib/audience-store";
import { progressFraction } from "@/lib/time";
import {
  Button,
  Chip,
  colors,
  EmptyState,
  gutter,
  IconButton,
  Poster,
  spacing,
  Text,
} from "@/ui";

type Shelf = "progress" | "saved" | "finished";

interface Item {
  id: string;
  title: string;
  posterPath: string | null;
  progress?: number;
  episodeId?: string | null;
}

const COLUMNS = 3;

/** In progress, Saved, Finished: a plain poster grid. */
export function ShelfScreen() {
  const { width } = useWindowDimensions();
  const { lead, key } = useAudience();
  const [shelf, setShelf] = useState<Shelf>("progress");
  const tonight = useTonight(key);
  const saved = useWatchlist(lead.id);
  const highlights = useHighlights(key);
  const poster = (width - gutter * 2 - spacing.md * (COLUMNS - 1)) / COLUMNS;

  const items: Item[] =
    shelf === "progress"
      ? (tonight.data?.continue ?? []).map(({ title, progress }) => ({
          id: title.id,
          title: title.title,
          posterPath: title.posterPath,
          progress: progressFraction(progress.positionS, progress.durationS),
          episodeId: progress.episodeId,
        }))
      : shelf === "saved"
        ? (saved.data ?? []).map((title) => ({
            id: title.id,
            title: title.title,
            posterPath: title.posterPath,
          }))
        : (highlights.data ?? [])
            .filter((h) => h.kind === "watched")
            .map((h) => ({ id: h.id, title: h.title, posterPath: null }));
  const loading =
    shelf === "progress"
      ? tonight.isPending
      : shelf === "saved"
        ? saved.isPending
        : highlights.isPending;

  return (
    <View style={styles.screen}>
      <StudioHeader
        actions={
          <IconButton
            icon={Settings}
            label="Profiles and account"
            size={20}
            color={colors.muted}
            onPress={() => router.push("/account")}
          />
        }
      />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.top}>
            <Text variant="hero">Your shelf</Text>
            <View style={styles.tabs}>
              <Chip
                label="In progress"
                selected={shelf === "progress"}
                onPress={() => setShelf("progress")}
              />
              <Chip
                label="Saved"
                selected={shelf === "saved"}
                onPress={() => setShelf("saved")}
              />
              <Chip
                label="Finished"
                selected={shelf === "finished"}
                onPress={() => setShelf("finished")}
              />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() =>
              item.progress !== undefined
                ? playTitle(item.id, item.episodeId)
                : openTitle(item.id)
            }
            onLongPress={() => openTitle(item.id)}
            style={({ pressed }) => [
              styles.item,
              { width: poster, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Poster title={item} width={poster} progress={item.progress} />
            <Text variant="caption" color="muted" numberOfLines={1}>
              {item.title}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? null : shelf === "progress" ? (
            <EmptyState
              icon={Clock}
              title="Nothing on the go"
              message="Anything you start watching waits here, so you can pick it up where you left off."
            />
          ) : shelf === "saved" ? (
            <EmptyState
              icon={Bookmark}
              title="Nothing saved yet"
              message="Tap Save on anything that catches your eye and it'll be kept here for later."
              action={
                <Button
                  label="Turn some dials"
                  variant="secondary"
                  onPress={() => router.navigate("/tune")}
                />
              }
            />
          ) : (
            <EmptyState
              icon={CircleCheck}
              title="Nothing finished yet"
              message="Films and series you've watched to the end collect here — and light up as stars on the Map."
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { paddingHorizontal: gutter, paddingBottom: 140, gap: spacing.lg },
  top: { paddingTop: spacing.xl, gap: spacing.lg, paddingBottom: spacing.lg },
  tabs: { flexDirection: "row", gap: spacing.sm },
  row: { gap: spacing.md },
  item: { gap: spacing.xs },
});
