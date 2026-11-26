/**
 * Creates the credit-pack catalog in the Polar organization behind
 * POLAR_ACCESS_TOKEN (POLAR_ENVIRONMENT=sandbox|production). Idempotent by
 * product name: an existing pack is left alone, so prices change in Polar.
 *
 *   POLAR_ACCESS_TOKEN=polar_oat_… POLAR_ENVIRONMENT=sandbox bun scripts/polar-setup.ts
 */
import { createPolar } from "@polar-sh/sdk/2026-10";

const currency = process.env.POLAR_CURRENCY === "usd" ? "usd" : "eur";

const packs = [
  { name: "Stockwatcher 500 credits", credits: 500, price: 500 },
  { name: "Stockwatcher 1,200 credits", credits: 1200, price: 1000 },
  { name: "Stockwatcher 3,500 credits", credits: 3500, price: 2500 },
];

const accessToken = process.env.POLAR_ACCESS_TOKEN;
if (!accessToken) throw new Error("Set POLAR_ACCESS_TOKEN.");
const environment =
  process.env.POLAR_ENVIRONMENT === "production" ? "production" : "sandbox";
const polar = createPolar({ accessToken, environment });

const existing = new Map<string, string>();
for await (const product of polar.products.iterList({ is_archived: false }))
  existing.set(product.name, product.id);

for (const pack of packs) {
  const found = existing.get(pack.name);
  if (found) {
    console.log(`kept    ${pack.name} (${found})`);
    continue;
  }
  const product = await polar.products.create({
    name: pack.name,
    description: `${pack.credits.toLocaleString("en-US")} credits for the Stockwatcher assistant. Credits do not expire.`,
    recurring_interval: null,
    prices: [
      {
        amount_type: "fixed",
        price_amount: pack.price,
        price_currency: currency,
      },
    ],
    metadata: { credits: pack.credits },
  });
  console.log(`created ${pack.name} (${product.id})`);
}
console.log(`Polar ${environment}: ${packs.length} packs in place.`);
