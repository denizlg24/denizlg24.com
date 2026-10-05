import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
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
import { createStore, useStore } from "@/lib/store";
import { gutter, Screen, spacing } from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { toolbarText } from "@/ui/toolbar";
import { CaloriePill } from "./components/calorie-pill";
import { type HubTab, HubTabs, isHubTab } from "./components/hub-tabs";
import { PlateHeaderButton } from "./components/plate-button";
import { PLATE_DOCK_CLEARANCE, PlateDock } from "./components/plate-dock";
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
import { readParam, routedLogTime, useZone } from "./target";

// The search text lives outside the hub's state: a keystroke that re-rendered
// the hub rebuilt every header option (title, toolbars, the search bar
// itself) while the native field was still delivering text.
const hubQuery = createStore({ text: "" });

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
    hubQuery.set({ text: "" });
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
          headerRight: () => <PlateHeaderButton />,
        }}
      />
      <Stack.SearchBar
        placeholder="Search for a food"
        autoCapitalize="none"
        // Under the bar, not in a bottom toolbar: there the focused field took
        // the whole row and the Log button with it.
        placement="stacked"
        hideWhenScrolling={false}
        hideNavigationBar={false}
        obscureBackground={false}
        onChangeText={(event) => {
          const text = event.nativeEvent.text;
          hubQuery.set((current) =>
            current.text === text ? current : { text },
          );
        }}
        onCancelButtonPress={() => hubQuery.set({ text: "" })}
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

      <Screen
        bleed
        stickyHeaderIndices={[0]}
        contentContainerStyle={[
          styles.content,
          plate.length > 0 && { paddingBottom: PLATE_DOCK_CLEARANCE },
        ]}
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
      <PlateDock
        items={plate}
        energyUnit={zone.energyUnit}
        onOpen={() => router.push("/add-food/plate")}
        onLog={() => commit(plate)}
      />
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
  const { text: query } = useHubQuery();
  return tab === "search" ? (
    <SearchBody
      query={query}
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
