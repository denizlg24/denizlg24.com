import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { API_URL } from "@/lib/config";
import { colors, Icon, type IconName, radius, Skeleton } from "@/ui";

const GLYPHS: ReadonlyArray<readonly [RegExp, IconName]> = [
  [/carrot|vegetable|salad|lettuce|spinach|kale|greens|cabbage/i, "carrot"],
  [
    /apple|pear|banana|orange|lemon|lime|citrus|cherry|grape|fruit|berry/i,
    "apple",
  ],
  [/fish|salmon|tuna|cod|shrimp/i, "fish"],
  [/coffee|tea|espresso/i, "coffee"],
  [/soda|juice|drink|beverage|water/i, "cup-soda"],
  [/milk|yogurt|cream|cheese/i, "milk"],
  [/cake|cookie|biscuit|candy|sweet|ice cream|gelato/i, "cake"],
  [/popcorn/i, "popcorn"],
  [/wine|beer/i, "wine"],
];

// Icons already drawn this session start drawn: a row that remounts or is
// recycled onto one must not flash its placeholder for a frame.
const loadedIcons = new Set<string>();

export interface FoodIconProps {
  name: string;
  iconKey?: string | null;
  entryType?: "food" | "recipe" | "quick_add";
  size?: number;
}

function iconUri(iconKey: string): string {
  const assetKey = iconKey === "other-001" ? "other-006" : iconKey;
  return `${API_URL}/food-icons/${encodeURIComponent(assetKey)}.png`;
}

/**
 * The same illustrated catalogue the web app uses, served from its public
 * folder and cached on disk by expo-image. A placeholder of the final size
 * holds the spot until the picture arrives; an SF Symbol stands in when a
 * food has no catalogue icon or its picture cannot be fetched.
 */
export function FoodIcon({
  name,
  iconKey,
  entryType = "food",
  size = 36,
}: FoodIconProps) {
  const uri = entryType !== "quick_add" && iconKey ? iconUri(iconKey) : null;
  // Keyed by URI, so a recycled row showing another food starts over.
  const [outcome, setOutcome] = useState<{
    uri: string;
    loaded: boolean;
  } | null>(null);
  const settled = outcome?.uri === uri ? outcome : null;
  const failed = settled?.loaded === false;
  const loaded =
    settled?.loaded === true || (uri !== null && loadedIcons.has(uri));

  if (uri && !failed) {
    return (
      <View style={{ width: size, height: size, overflow: "hidden" }}>
        {loaded ? null : (
          <Skeleton
            width={size}
            height={size}
            radius={radius.sm}
            style={StyleSheet.absoluteFill}
          />
        )}
        <Image
          source={{ uri }}
          recyclingKey={uri}
          // The PNGs fill ~68% of their box; scale out the baked-in margin.
          style={{ width: size, height: size, transform: [{ scale: 1.3 }] }}
          cachePolicy="memory-disk"
          contentFit="contain"
          accessible={false}
          onLoad={() => {
            loadedIcons.add(uri);
            setOutcome({ uri, loaded: true });
          }}
          onError={() => setOutcome({ uri, loaded: false })}
        />
      </View>
    );
  }

  const glyph: IconName =
    entryType === "recipe"
      ? "chef-hat"
      : entryType === "quick_add"
        ? "zap"
        : (GLYPHS.find(([pattern]) => pattern.test(name))?.[1] ?? "utensils");

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.sm,
        backgroundColor: colors.tertiaryFill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={glyph} size={size * 0.5} color={colors.secondaryLabel} />
    </View>
  );
}
