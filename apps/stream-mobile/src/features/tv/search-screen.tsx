import type { TitleSummary } from "@repo/schemas/stream";
import { Search, SearchX } from "lucide-react-native";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useTitles } from "@/api/stream";
import { EMPTY_FILTERS } from "@/lib/title-query";
import { Button, colors, EmptyState, fonts, radius, spacing } from "@/ui";
import { FocusedSpotlight, FocusedTitle, TvNavBar } from "./chrome";
import { TV_SAFE } from "./layout";
import { TvPosterGrid } from "./poster-grid";
import { useSpotlight } from "./spotlight";

/**
 * One field; OK opens the TV's own keyboard, which on Google TV also takes
 * the remote's microphone. Results fill in below as you type.
 */
export function TvSearchScreen() {
  const input = useRef<TextInput>(null);
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const spotlight = useSpotlight<TitleSummary>();
  const deferred = useDeferredValue(q.trim());
  const titles = useTitles({ ...EMPTY_FILTERS, q: deferred });
  const items = useMemo(
    () =>
      deferred ? (titles.data?.pages.flatMap((page) => page.titles) ?? []) : [],
    [deferred, titles.data],
  );

  // Android's preferred focus is a view-group prop a text field ignores, so
  // the field is focused by hand; on a TV that also brings up the keyboard,
  // which is what arriving at Search is for.
  useEffect(() => {
    input.current?.focus();
  }, []);

  return (
    <View style={styles.screen}>
      <FocusedTitle spotlight={spotlight} />
      <TvNavBar current="search" />
      <View style={[styles.field, focused ? styles.fieldFocused : null]}>
        <Search color={focused ? colors.amber : colors.muted} size={22} />
        <TextInput
          value={q}
          onChangeText={setQ}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search for a film or series"
          placeholderTextColor={colors.faint}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search for a film or series"
          ref={input}
          style={styles.input}
        />
      </View>
      <FocusedSpotlight spotlight={spotlight} />
      <ScrollView
        style={styles.results}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {deferred && titles.isPending ? (
          <ActivityIndicator color={colors.muted} size="large" />
        ) : deferred && items.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Nothing matched"
            message={`We couldn't find anything called "${deferred}". Check the spelling, or try fewer words.`}
          />
        ) : (
          <>
            <TvPosterGrid titles={items} onFocusTitle={spotlight.set} />
            {titles.hasNextPage && deferred ? (
              <View style={styles.more}>
                <Button
                  label="Show more"
                  variant="secondary"
                  size="large"
                  loading={titles.isFetchingNextPage}
                  onPress={() => void titles.fetchNextPage()}
                />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: TV_SAFE.x,
    marginVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
    maxWidth: 560,
  },
  fieldFocused: { borderColor: colors.amber },
  input: {
    flex: 1,
    minHeight: 52,
    color: colors.paper,
    fontFamily: fonts.regular,
    fontSize: 19,
  },
  results: { flex: 1 },
  content: { paddingBottom: TV_SAFE.y + spacing.xl, gap: spacing.lg },
  more: { paddingHorizontal: TV_SAFE.x, flexDirection: "row" },
});
