import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useCalorieSummary } from "@/api/dashboard";
import { FailedWritesNotice } from "@/components/failed-writes-notice";
import { useCurrentMinute } from "@/lib/day";
import { haptics } from "@/lib/haptics";
import {
  followsClock,
  hourOf,
  logPlacement,
  logTimeParams,
} from "@/lib/log-time";
import { colors, gutter, Screen, spacing } from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { toolbarText } from "@/ui/toolbar";
import { CaloriePill } from "./components/calorie-pill";
import { type HubTab, HubTabs, isHubTab } from "./components/hub-tabs";
import type { QuickHandlers } from "./components/quick-section";
import { LibraryBody, RecipesBody, ShopBody } from "./hub-lists";
import { SearchBody } from "./hub-search";
import { hubTime, hubTimeLabel, useHubTime } from "./hub-time";
import { useLogActions } from "./log-actions";
import { useCommitPlate } from "./plate-commit";
import { addToPlate, plateTotals, usePlate } from "./plate-store";
import {
  type Placement,
  quickHref,
  quickPlateItem,
  quickRequest,
} from "./search-rows";
import { createStore, useStore } from "./store";
import { readParam, routedLogTime, useZone } from "./target";

// The search text lives outside the hub's state: a keystroke that re-rendered
// the hub rebuilt every header option (title, toolbars, the search bar
// itself) while the native field was still delivering text.
const hubQuery = createStore({ text: "", submitted: 0 });

function useHubQuery() {
  return useStore(hubQuery);
}

/**
 * Every way into the log in one place: search, recipes, your own foods and
 * the shopping list, with a plate collecting what is picked until it is
 * logged together.
 */
export function HubScreen() {
  const params = useLocalSearchParams();
  const paramDate = readParam(params.date);
  const paramTime = readParam(params.time);
  const zone = useZone();

  // Opened from a day or an hour of the Log tab it starts there; opened
  // plainly it starts at now, whatever was picked the last time.
  useEffect(() => {
    const routed = routedLogTime(
      { date: paramDate, time: paramTime },
      zone.today,
    );
    hubTime.set(followsClock(routed, zone.today) ? null : routed);
  }, [paramDate, paramTime, zone.today]);

  const when = useHubTime(zone.today);
  const now = useCurrentMinute(when.clock === null);
  const whenParams = logTimeParams(when, zone.today);

  const [tab, setTab] = useState<HubTab>(() => {
    const open = readParam(params.open);
    return isHubTab(open) ? open : "search";
  });
  const plate = usePlate();
  useEffect(() => {
    hubQuery.set({ text: "", submitted: 0 });
  }, []);
  const staged = plateTotals(plate).calories;
  const summary = useCalorieSummary(zone.today).data;
  const { log } = useLogActions();
  const { commit } = useCommitPlate(() => router.back());

  function placement(): Placement {
    return logPlacement(when, zone.timeZone);
  }

  const handlers: QuickHandlers = {
    stage: (quick) => {
      haptics.light();
      addToPlate(quickPlateItem(quick, placement()));
    },
    logNow: (quick) =>
      log(
        quickRequest(quick, placement()),
        quick.row.name,
        quick.row.key,
        quick.macros,
      ),
    open: (quick) => router.push(quickHref(quick, whenParams)),
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <CaloriePill
              consumed={summary?.consumed ?? 0}
              staged={staged}
              target={summary?.target ?? null}
              energyUnit={zone.energyUnit}
            />
          ),
        }}
      />
      <Stack.SearchBar
        placeholder="Search for a food"
        autoCapitalize="none"
        hideWhenScrolling={false}
        // The calorie pill and the plate stay in view while typing.
        hideNavigationBar={false}
        obscureBackground={false}
        onChangeText={(event) => {
          const text = event.nativeEvent.text;
          hubQuery.set((current) =>
            current.text === text ? current : { ...current, text },
          );
        }}
        // Search runs as you type; the key sends the field as it stands now,
        // even while an earlier request is still in flight.
        onSearchButtonPress={(event) => {
          const text = event.nativeEvent.text;
          hubQuery.set((current) => ({
            text,
            submitted: current.submitted + 1,
          }));
        }}
        onCancelButtonPress={() => hubQuery.set({ text: "", submitted: 0 })}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={glyphs.x}
          iconRenderingMode="template"
          accessibilityLabel="Close"
          onPress={() => router.back()}
        />
        {toolbarText({
          accessibilityLabel: "When these foods were eaten",
          onPress: () => router.push("/add-food/when"),
          children: hubTimeLabel(when, zone.timeZone, zone.today, now),
        })}
      </Stack.Toolbar>
      {/* Always mounted: a header item that came and went with the plate
          only sometimes reappeared. Empty, it is disabled and unbadged. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphs.utensils}
          iconRenderingMode="template"
          accessibilityLabel={`Plate, ${plate.length} ${plate.length === 1 ? "food" : "foods"}`}
          disabled={plate.length === 0}
          onPress={() => router.push("/add-food/plate")}
        >
          {plate.length > 0 ? (
            <Stack.Toolbar.Badge>{String(plate.length)}</Stack.Toolbar.Badge>
          ) : null}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      {/* Android has no search slot; its search field stays in the header. */}
      {Platform.OS === "ios" ? (
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.SearchBarSlot />
          {toolbarText({
            accessibilityLabel: `Log ${plate.length} ${plate.length === 1 ? "food" : "foods"}`,
            variant: "done",
            tintColor: colors.tint,
            hidden: plate.length === 0,
            onPress: () => commit(plate),
            children: "Log",
          })}
        </Stack.Toolbar>
      ) : null}

      <Screen
        bleed
        stickyHeaderIndices={[0]}
        contentContainerStyle={styles.content}
      >
        <HubTabs
          value={tab}
          onChange={setTab}
          onScan={() => router.push({ pathname: "/scan", params: whenParams })}
        />
        <View>
          <View style={styles.inset}>
            <FailedWritesNotice />
          </View>
          <HubBody
            tab={tab}
            when={when}
            now={now}
            handlers={handlers}
            placement={placement}
            log={log}
            createFoodParams={whenParams}
          />
        </View>
      </Screen>
    </>
  );
}

function HubBody({
  tab,
  when,
  now,
  handlers,
  placement,
  log,
  createFoodParams,
}: {
  tab: HubTab;
  when: ReturnType<typeof useHubTime>;
  now: Date;
  handlers: QuickHandlers;
  placement: () => Placement;
  log: ReturnType<typeof useLogActions>["log"];
  createFoodParams: Record<string, string>;
}) {
  const zone = useZone();
  const { text: query, submitted } = useHubQuery();
  return tab === "search" ? (
    <SearchBody
      query={query}
      submitted={submitted}
      hour={hourOf(when, zone.timeZone, now)}
      energyUnit={zone.energyUnit}
      handlers={handlers}
      createFoodParams={createFoodParams}
    />
  ) : tab === "recipes" ? (
    <RecipesBody
      query={query}
      energyUnit={zone.energyUnit}
      handlers={handlers}
      placement={placement}
      log={log}
    />
  ) : tab === "library" ? (
    <LibraryBody
      query={query}
      energyUnit={zone.energyUnit}
      handlers={handlers}
      createFoodParams={createFoodParams}
    />
  ) : (
    <ShopBody query={query} />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 0,
  },
  inset: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
  },
});
