import { readFileSync } from "node:fs";
import { z } from "zod";

export interface PlayApp {
  ticker: string;
  package: string;
}

const appsSchema = z.array(
  z.object({
    ticker: z.string().trim().min(1),
    package: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._]+$/),
  }),
);

const defaults: [string, string][] = [
  ["META", "com.facebook.katana"],
  ["META", "com.instagram.android"],
  ["META", "com.whatsapp"],
  ["UBER", "com.ubercab"],
  ["LYFT", "me.lyft.android"],
  ["ABNB", "com.airbnb.android"],
  ["DASH", "com.dd.doordash"],
  ["CART", "com.instacart.client"],
  ["SPOT", "com.spotify.music"],
  ["NFLX", "com.netflix.mediaclient"],
  ["DIS", "com.disney.disneyplus"],
  ["PYPL", "com.paypal.android.p2pmobile"],
  ["PYPL", "com.venmo"],
  ["XYZ", "com.squareup.cash"],
  ["HOOD", "com.robinhood.android"],
  ["COIN", "com.coinbase.android"],
  ["SOFI", "com.sofi.mobile"],
  ["AFRM", "com.affirm.central"],
  ["SNAP", "com.snapchat.android"],
  ["PINS", "com.pinterest"],
  ["RDDT", "com.reddit.frontpage"],
  ["RBLX", "com.roblox.client"],
  ["DUOL", "com.duolingo"],
  ["AMZN", "com.amazon.mShop.android.shopping"],
  ["GOOGL", "com.google.android.youtube"],
  ["MSFT", "com.microsoft.teams"],
  ["ZM", "us.zoom.videomeetings"],
  ["CRM", "com.Slack"],
  ["DBX", "com.dropbox.android"],
  ["SHOP", "com.shopify.mobile"],
  ["ETSY", "com.etsy.android"],
  ["EBAY", "com.ebay.mobile"],
  ["CVNA", "com.carvana.carvana"],
  ["Z", "com.zillow.android.zillowmap"],
  ["YELP", "com.yelp.android"],
  ["KIND", "com.nextdoor"],
  ["BMBL", "com.bumble.app"],
  ["MTCH", "com.tinder"],
  ["PTON", "com.onepeloton.callisto"],
  ["DKNG", "com.draftkings.sportsbook"],
  ["TTWO", "com.zynga.words3"],
  ["EA", "com.ea.gp.fifamobile"],
  ["BKNG", "com.booking"],
  ["EXPE", "com.expedia.bookings"],
  ["TRIP", "com.tripadvisor.tripadvisor"],
  ["WMT", "com.walmart.android"],
  ["TGT", "com.target.ui"],
  ["COST", "com.costco.app.android"],
  ["HD", "com.thehomedepot"],
  ["BBY", "com.bestbuy.android"],
  ["CHWY", "com.chewy.android"],
  ["NKE", "com.nike.omega"],
  ["SBUX", "com.starbucks.mobilecard"],
  ["MCD", "com.mcdonalds.app"],
  ["CMG", "com.chipotle.ordering"],
  ["DPZ", "com.dominospizza"],
  ["CVS", "com.cvs.launchers.cvs"],
];

export const DEFAULT_PLAY_APPS: PlayApp[] = defaults.map(
  ([ticker, packageId]) => ({ ticker, package: packageId }),
);

/** Inline JSON when the value starts with `[`, otherwise a path to a JSON file. */
export function loadPlayApps(configured: string | undefined): PlayApp[] {
  const value = configured?.trim();
  if (!value) return DEFAULT_PLAY_APPS;
  const text = value.startsWith("[") ? value : readFileSync(value, "utf8");
  return appsSchema
    .parse(JSON.parse(text))
    .map((app) => ({ ticker: app.ticker.toUpperCase(), package: app.package }));
}
