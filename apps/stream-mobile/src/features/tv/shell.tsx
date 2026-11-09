import type { Profile } from "@repo/schemas/stream";
import { LinearGradient } from "expo-linear-gradient";
import { type Href, router, useFocusEffect } from "expo-router";
import {
  Film,
  Flame,
  House,
  type LucideIcon,
  Plus,
  Search,
  Tv,
} from "lucide-react-native";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BackHandler, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { audienceNames } from "@/lib/audience";
import { useAudience } from "@/lib/audience-store";
import { colors, profileColors, spacing } from "@/ui";
import {
  type FocusMemory,
  FocusMemoryContext,
  useFocusMemoryState,
} from "./focus-memory";
import { Focusable, useNativeTag } from "./focusable";
import { RAIL, TV_SAFE } from "./layout";
import { useRemote } from "./remote";
import { TvText } from "./tv-text";

export type TvSection = "search" | "home" | "series" | "films" | "new" | "list";

const SECTIONS: {
  key: TvSection;
  label: string;
  icon: LucideIcon;
  href: Href;
}[] = [
  { key: "search", label: "Search", icon: Search, href: "/tv/search" },
  { key: "home", label: "Home", icon: House, href: "/tv" },
  { key: "series", label: "Series", icon: Tv, href: "/tv/series" },
  { key: "films", label: "Films", icon: Film, href: "/tv/films" },
  { key: "new", label: "New & Popular", icon: Flame, href: "/tv/new" },
  { key: "list", label: "My List", icon: Plus, href: "/tv/list" },
];

type RailKey = TvSection | "profile";

/**
 * Every browsing screen: the content, full screen, under a navigation rail
 * collapsed to icons along the left. Pressing left from the first column
 * lands on an invisible catcher that opens the rail over a dark shade with
 * the current section focused; pressing right lands on a second catcher
 * that sends focus back to exactly where it was. Back from the content opens
 * the rail (or whatever `onBack` handles first); Back from the rail goes
 * Home, and from Home's rail leaves the app.
 */
export function TvShell({
  section,
  onBack,
  children,
}: {
  section: TvSection;
  /** True when the screen handled Back itself, e.g. by jumping to the top. */
  onBack?: () => boolean;
  children: ReactNode;
}) {
  const memory = useFocusMemoryState();
  const [aim, setAim] = useState<{ key: RailKey } | null>(null);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  const backRef = useRef(onBack);
  backRef.current = onBack;

  const openRail = useCallback(() => {
    setOpen(true);
    setAim({ key: section });
  }, [section]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (openRef.current) {
            if (section === "home") return false;
            router.replace("/tv");
            return true;
          }
          if (backRef.current?.()) return true;
          openRail();
          return true;
        },
      );
      // Coming back from a title page: focus returns to the tile it left.
      const back = setTimeout(() => memory.restore(), 60);
      return () => {
        clearTimeout(back);
        subscription.remove();
      };
    }, [section, openRail, memory]),
  );

  return (
    <FocusMemoryContext value={memory}>
      <View style={styles.screen}>
        {children}
        <Rail
          section={section}
          open={open}
          aim={aim}
          memory={memory}
          onOpen={openRail}
          onClose={() => setOpen(false)}
          onAimed={() => setAim(null)}
        />
      </View>
    </FocusMemoryContext>
  );
}

const Rail = memo(function Rail({
  section,
  open,
  aim,
  memory,
  onOpen,
  onClose,
  onAimed,
}: {
  section: TvSection;
  open: boolean;
  aim: { key: RailKey } | null;
  memory: FocusMemory;
  onOpen: () => void;
  onClose: () => void;
  onAimed: () => void;
}) {
  const { audience } = useAudience();
  const exit = useNativeTag();
  const [entryFocused, setEntryFocused] = useState(false);
  // Open, the rail's items overlap the content, so Android's geometric
  // search can jump from one to a button beside the next: name neighbours.
  const [tags, setTags] = useState<Partial<Record<RailKey, number>>>({});
  const noteTag = useCallback((key: RailKey, tag: number) => {
    setTags((current) =>
      current[key] === tag ? current : { ...current, [key]: tag },
    );
  }, []);
  const inside = useRef(false);
  const exitFocused = useRef(false);
  const shown = useSharedValue(0);

  useRemote(() => {
    if (!open) onOpen();
  }, entryFocused && !open);

  useEffect(() => {
    shown.value = withTiming(open ? 1 : 0, { duration: 180 });
  }, [open, shown]);

  const shade = useAnimatedStyle(() => ({ opacity: shown.value }));

  const leaveSoon = () => {
    inside.current = false;
    setTimeout(() => {
      if (!inside.current && !exitFocused.current) onClose();
    }, 60);
  };

  const choose = (key: RailKey) => {
    if (key === "profile") {
      router.push("/tv/who");
      return;
    }
    if (key === section) {
      // Focus leaving the item is what closes the rail.
      memory.restore();
      return;
    }
    const target = SECTIONS.find((item) => item.key === key);
    if (target) router.replace(target.href);
  };

  const keys: RailKey[] = ["profile", ...SECTIONS.map((item) => item.key)];
  const tagAt = (index: number): number | null => {
    const key = keys[index];
    return key ? (tags[key] ?? null) : null;
  };

  return (
    <View pointerEvents="box-none" style={styles.rail}>
      <LinearGradient
        pointerEvents="none"
        colors={[
          "rgba(12,11,10,0.94)",
          "rgba(12,11,10,0.6)",
          "rgba(12,11,10,0)",
        ]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.collapsedShade}
      />
      <Animated.View pointerEvents="none" style={[styles.openShade, shade]}>
        <LinearGradient
          colors={[
            "rgba(12,11,10,0.98)",
            "rgba(12,11,10,0.9)",
            "rgba(12,11,10,0)",
          ]}
          locations={[0, 0.32, 0.75]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Pressable
        accessibilityLabel="Open the menu"
        focusable={!open || entryFocused}
        onFocus={() => {
          setEntryFocused(true);
          // Android hands a screen with nothing focusable yet (still
          // loading) to the first focusable view, which is this one: only
          // a real press opens the rail then.
          if (memory.last() !== null) onOpen();
        }}
        onPress={onOpen}
        onBlur={() => setEntryFocused(false)}
        style={styles.entry}
      />

      <View pointerEvents="box-none" style={styles.profile}>
        <RailItem
          railKey="profile"
          label={audienceNames(audience)}
          profile={audience[0] ?? null}
          extra={audience.length - 1}
          current={false}
          open={open}
          aimed={aim?.key === "profile"}
          exitTag={exit.tag}
          upTag={null}
          downTag={tagAt(1)}
          onNativeTag={noteTag}
          first
          last={false}
          shown={shown}
          onFocus={() => {
            inside.current = true;
            if (aim) onAimed();
          }}
          onBlur={leaveSoon}
          onPress={choose}
        />
      </View>
      <View pointerEvents="box-none" style={styles.items}>
        {SECTIONS.map((item, index) => (
          <RailItem
            key={item.key}
            railKey={item.key}
            label={item.label}
            icon={item.icon}
            current={item.key === section}
            open={open}
            aimed={aim?.key === item.key}
            exitTag={exit.tag}
            upTag={tagAt(index)}
            downTag={tagAt(index + 2)}
            onNativeTag={noteTag}
            first={false}
            last={item.key === keys.at(-1)}
            shown={shown}
            onFocus={() => {
              inside.current = true;
              if (aim) onAimed();
            }}
            onBlur={leaveSoon}
            onPress={choose}
          />
        ))}
      </View>

      <Pressable
        ref={exit.ref}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        focusable={open}
        accessible={open}
        onFocus={() => {
          exitFocused.current = true;
          memory.restore();
          // Nothing to go back to (it unmounted): stay in the rail.
          setTimeout(() => {
            if (exitFocused.current) onOpen();
          }, 400);
        }}
        onBlur={() => {
          exitFocused.current = false;
          leaveSoon();
        }}
        style={styles.exit}
      />
    </View>
  );
});

const RailItem = memo(function RailItem({
  railKey,
  label,
  icon: Icon,
  profile,
  extra = 0,
  current,
  open,
  aimed,
  exitTag,
  upTag,
  downTag,
  onNativeTag,
  first,
  last,
  shown,
  onFocus,
  onBlur,
  onPress,
}: {
  railKey: RailKey;
  label: string;
  icon?: LucideIcon;
  profile?: Profile | null;
  extra?: number;
  current: boolean;
  open: boolean;
  aimed: boolean;
  exitTag: number | null;
  upTag: number | null;
  downTag: number | null;
  onNativeTag: (key: RailKey, tag: number) => void;
  first: boolean;
  last: boolean;
  /** 0 collapsed, 1 open: the label fades and slides in with it. */
  shown: SharedValue<number>;
  onFocus: () => void;
  onBlur: () => void;
  onPress: (key: RailKey) => void;
}) {
  const noteTag = useCallback(
    (tag: number) => onNativeTag(railKey, tag),
    [onNativeTag, railKey],
  );
  const labels = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateX: (1 - shown.value) * -12 }],
  }));
  return (
    <Focusable
      accessibilityRole="tab"
      accessibilityLabel={
        railKey === "profile" ? `${label}. Switch profiles` : label
      }
      accessibilityState={{ selected: current }}
      focusable={open}
      preferred={open && aimed}
      next={{
        left: "self",
        right: exitTag ?? undefined,
        up: first ? "self" : (upTag ?? undefined),
        down: last ? "self" : (downTag ?? undefined),
      }}
      onNativeTag={noteTag}
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={() => onPress(railKey)}
      ringless
      grow={1}
    >
      {(focused) => (
        <View
          style={[
            styles.item,
            focused ? { backgroundColor: "rgba(239,233,223,0.14)" } : null,
          ]}
        >
          <View style={styles.icon}>
            {profile ? (
              <ProfileSquare profile={profile} size={30} extra={extra} />
            ) : Icon ? (
              <Icon
                size={24}
                strokeWidth={current || focused ? 2.4 : 1.8}
                color={
                  focused ? colors.paper : current ? colors.amber : colors.muted
                }
              />
            ) : null}
          </View>
          <Animated.View style={[styles.labelBox, labels]}>
            <TvText
              variant={focused || current ? "navStrong" : "nav"}
              color={focused ? "paper" : current ? "amber" : "muted"}
              numberOfLines={1}
            >
              {label}
            </TvText>
          </Animated.View>
        </View>
      )}
    </Focusable>
  );
});

/** A profile's colour square with its initial; a small count when several watch. */
export function ProfileSquare({
  profile,
  size,
  extra = 0,
}: {
  profile: Pick<Profile, "name" | "color">;
  size: number;
  extra?: number;
}) {
  return (
    <View
      style={[
        styles.square,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.16),
          backgroundColor: profileColors[profile.color],
        },
      ]}
    >
      <TvText
        style={{
          fontSize: size * 0.56,
          lineHeight: Math.round(size * 0.62),
          color: colors.ink,
        }}
        variant="marquee"
      >
        {profile.name.trim().charAt(0).toUpperCase() || "?"}
      </TvText>
      {extra > 0 ? (
        <View style={styles.extra}>
          <TvText variant="caption" color="ink">
            +{extra}
          </TvText>
        </View>
      ) : null}
    </View>
  );
}

const ICON_X = TV_SAFE.x - spacing.sm;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  rail: { ...StyleSheet.absoluteFill },
  collapsedShade: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: RAIL.collapsed + 40,
  },
  openShade: { ...StyleSheet.absoluteFill },
  entry: { position: "absolute", left: 0, top: 0, bottom: 0, width: 32 },
  exit: {
    position: "absolute",
    left: RAIL.expanded,
    top: 0,
    bottom: 0,
    width: 24,
  },
  profile: { position: "absolute", left: ICON_X, top: TV_SAFE.y },
  items: {
    position: "absolute",
    left: ICON_X,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    gap: spacing.xs,
  },
  item: {
    width: RAIL.expanded - ICON_X - spacing.lg,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  icon: { width: 30, alignItems: "center", justifyContent: "center" },
  labelBox: { flex: 1 },
  square: { alignItems: "center", justifyContent: "center" },
  extra: {
    position: "absolute",
    right: -6,
    bottom: -6,
    minWidth: 18,
    paddingHorizontal: 3,
    borderRadius: 9,
    backgroundColor: colors.paper,
    alignItems: "center",
  },
});
