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
import { gutter, Screen, spacing } from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { toolbarText } from "@/ui/toolbar";
import { CaloriePill } from "./components/calorie-pill";
import { type HubTab, HubTabs, isHubTab } from "./components/hub-tabs";
import type { QuickHandlers } from "./components/quick-section";
import { LibraryBody, RecipesBody, ShopBody } from "./hub-lists";
import { SearchBody } from "./hub-search";
import { hubTime, hubTimeLabel, useHubTime } from "./hub-time";
import { useLogActions } from "./log-actions";
import { addToPlate, plateTotals, usePlate } from "./plate-store";
import {
  type Placement,
  quickHref,
  quickPlateItem,
  quickRequest,
} from "./search-rows";
import { readParam, routedLogTime, useZone } from "./target";

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
  const [query, setQuery] = useState("");
  const plate = usePlate();
  const staged = plateTotals(plate).calories;
  const summary = useCalorieSummary(zone.today).data;
  const { log } = useLogActions();

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
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        onCancelButtonPress={() => setQuery("")}
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
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphs.utensils}
          iconRenderingMode="template"
          accessibilityLabel={`Plate, ${plate.length} ${plate.length === 1 ? "food" : "foods"}`}
          hidden={plate.length === 0}
          onPress={() => router.push("/add-food/plate")}
        >
          <Stack.Toolbar.Badge>{String(plate.length)}</Stack.Toolbar.Badge>
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      {/* Android has no search slot; its search field stays in the header. */}
      {Platform.OS === "ios" ? (
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.SearchBarSlot />
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
          {tab === "search" ? (
            <SearchBody
              query={query}
              hour={hourOf(when, zone.timeZone, now)}
              energyUnit={zone.energyUnit}
              handlers={handlers}
              createFoodParams={whenParams}
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
              createFoodParams={whenParams}
            />
          ) : (
            <ShopBody query={query} />
          )}
        </View>
      </Screen>
    </>
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
