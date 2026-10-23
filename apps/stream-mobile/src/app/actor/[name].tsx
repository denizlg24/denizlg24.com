import { decodeActorName } from "@repo/schemas/stream";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useActorTitles } from "@/api/stream";
import { openTitle } from "@/features/studio/open";
import { useAudience } from "@/lib/audience-store";
import { Button, colors, IconButton, Poster, Text } from "@/ui";
export default function Actor() {
  const params = useLocalSearchParams<{ name: string }>();
  const name = decodeActorName(params.name ?? "");
  const { lead } = useAudience();
  const result = useActorTitles(name, lead.id);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const size = (width - 56) / 2;
  return (
    <View
      style={{ flex: 1, backgroundColor: colors.ink, paddingTop: insets.top }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: 16,
          gap: 12,
        }}
      >
        <IconButton
          icon={ChevronLeft}
          label="Back"
          onPress={() => router.back()}
        />
        <Text variant="title" style={{ flex: 1 }}>
          {name}
        </Text>
      </View>
      <FlatList
        data={result.data?.pages.flatMap((page) => page.titles) ?? []}
        numColumns={2}
        keyExtractor={(title) => title.id}
        contentContainerStyle={{
          padding: 20,
          gap: 24,
          paddingBottom: insets.bottom + 24,
        }}
        columnWrapperStyle={{ gap: 16 }}
        ListHeaderComponent={
          <Text variant="footnote" color="muted">
            Films and series in the catalogue
          </Text>
        }
        ListEmptyComponent={
          result.isPending ? (
            <ActivityIndicator color={colors.amber} />
          ) : result.isError ? (
            <Button label="Try again" onPress={() => void result.refetch()} />
          ) : (
            <Text>No matching titles yet.</Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => openTitle(item.id)}
            style={{ width: size, gap: 8 }}
          >
            <Poster title={item} width={size} />
            <Text numberOfLines={2}>{item.title}</Text>
          </Pressable>
        )}
        onEndReached={() => {
          if (result.hasNextPage && !result.isFetchingNextPage)
            void result.fetchNextPage();
        }}
        ListFooterComponent={
          result.isFetchingNextPage ? (
            <ActivityIndicator color={colors.amber} />
          ) : null
        }
      />
    </View>
  );
}
