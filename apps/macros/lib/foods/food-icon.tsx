import {
  Apple,
  Banana,
  Bean,
  Beef,
  CakeSlice,
  Candy,
  Carrot,
  Cherry,
  Citrus,
  Cookie,
  CookingPot,
  Croissant,
  CupSoda,
  Drumstick,
  Egg,
  Fish,
  Grape,
  IceCreamBowl,
  LeafyGreen,
  type LucideIcon,
  Milk,
  Nut,
  Pizza,
  Popcorn,
  Salad,
  Sandwich,
  Soup,
  Utensils,
  Vegan,
  Wheat,
  Zap,
} from "lucide-react";

const FOOD_ICONS: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/rice|grain|oat|cereal|flour/i, Wheat],
  [/cabbage|lettuce|spinach|kale|greens/i, LeafyGreen],
  [/carrot/i, Carrot],
  [/leek|onion|shallot/i, Vegan],
  [/bean|pea|lentil/i, Bean],
  [/apple|pear/i, Apple],
  [/banana/i, Banana],
  [/orange|lemon|lime|citrus/i, Citrus],
  [/cherry/i, Cherry],
  [/grape/i, Grape],
  [/avocado|salad/i, Salad],
  [/potato|nut|peanut|almond|cashew/i, Nut],
  [/tomato/i, Vegan],
  [/egg/i, Egg],
  [/chicken|poultry|turkey/i, Drumstick],
  [/beef|steak|meat|pork|ham/i, Beef],
  [/fish|salmon|tuna|cod|shrimp/i, Fish],
  [/bread|toast|sandwich/i, Sandwich],
  [/croissant|pastry/i, Croissant],
  [/milk|yogurt|cream/i, Milk],
  [/cheese|pizza/i, Pizza],
  [/soup|stew/i, Soup],
  [/soda|juice|drink|beverage/i, CupSoda],
  [/popcorn/i, Popcorn],
  [/ice cream|gelato/i, IceCreamBowl],
  [/cookie|biscuit/i, Cookie],
  [/cake/i, CakeSlice],
  [/candy|sweet/i, Candy],
  [/fruit|vegetable|vegan/i, Vegan],
];

export function FoodIcon({
  name,
  iconKey,
  entryType = "food",
  className,
}: {
  name: string;
  iconKey?: string | null;
  entryType?: "food" | "recipe" | "quick_add";
  className?: string;
}) {
  if (entryType === "food" && iconKey) {
    return (
      <img
        src={`/food-icons/${encodeURIComponent(iconKey)}.png`}
        alt=""
        aria-hidden="true"
        className={className}
        width={128}
        height={128}
        decoding="async"
      />
    );
  }

  const Icon =
    entryType === "recipe"
      ? CookingPot
      : entryType === "quick_add"
        ? Zap
        : (FOOD_ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? Utensils);

  return <Icon aria-hidden="true" className={className} strokeWidth={1.8} />;
}
