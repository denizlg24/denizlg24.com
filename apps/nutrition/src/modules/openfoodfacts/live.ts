import { isGtinDigits, normalizeBarcode } from "@repo/macros-core/barcode";
import type { Database } from "../../db/client";
import { logger } from "../../shared/logger";
import { bulkUpsertProducts } from "../items/bulk-upsert";
import type { SearchIndexer } from "../search/indexer";
import { mapProduct, type OFFProduct, offProductFields } from "./map";

const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";
const USER_AGENT = "deniz-nutrition-api/1.1 (https://nutrition.denizlg24.com)";
const TIMEOUT_MS = 4_000;
const MISS_TTL_SECONDS = 24 * 60 * 60;

export interface MissCache {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
  ): Promise<unknown>;
}

/**
 * OpenFoodFacts publishes EAN-13 and EAN-8 codes without padding. A stored
 * GTIN-14 is tried as EAN-13 and, when it fits, as EAN-8.
 */
export const offCodesFor = (gtin14: string) => {
  const unpadded = gtin14.replace(/^0+/, "");
  const codes = [unpadded.padStart(13, "0")];
  if (unpadded.length <= 8) codes.push(unpadded.padStart(8, "0"));
  return [...new Set(codes)];
};

/**
 * The fallback MacroFactor keeps its legacy database for: a barcode the local
 * catalog does not know is fetched from OpenFoodFacts, stored like an
 * imported product, and indexed at once, so the next scan and every search
 * find it locally. Misses are cached for a day so a product nobody has
 * entered does not cost an upstream request per scan.
 */
export class OpenFoodFactsLiveLookup {
  constructor(
    private readonly database: Database,
    private readonly indexer: SearchIndexer,
    private readonly cache: MissCache,
  ) {}

  async resolve(rawBarcode: string): Promise<string | undefined> {
    const barcode = normalizeBarcode(rawBarcode);
    if (!isGtinDigits(barcode)) return undefined;

    const missKey = `nutrition:off-miss:${barcode}`;
    if (await this.cache.get(missKey).catch(() => null)) return undefined;

    const product = await this.fetchProduct(barcode);
    const mapped = product
      ? mapProduct({ ...product, code: barcode })
      : undefined;
    if (!mapped) {
      await this.cache
        .set(missKey, "1", "EX", MISS_TTL_SECONDS)
        .catch(() => undefined);
      return undefined;
    }

    const stored = await bulkUpsertProducts(this.database, [mapped], "replace");
    const itemId = stored.get(mapped.item.barcode);
    if (!itemId) return undefined;

    await this.indexer.index([itemId]).catch((error) =>
      logger.warn("live lookup indexing failed", {
        itemId,
        error: String(error),
      }),
    );
    logger.info("live lookup stored product", { barcode, itemId });
    return itemId;
  }

  private async fetchProduct(barcode: string): Promise<OFFProduct | undefined> {
    for (const code of offCodesFor(barcode)) {
      try {
        const response = await fetch(
          `${OFF_PRODUCT_URL}/${code}.json?fields=${offProductFields.join(",")}`,
          {
            headers: { "user-agent": USER_AGENT, accept: "application/json" },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
        if (!response.ok) continue;
        const body = (await response.json()) as {
          status?: number;
          product?: OFFProduct;
        };
        if (body.status === 1 && body.product) return body.product;
      } catch (error) {
        logger.warn("live lookup request failed", {
          code,
          error: String(error),
        });
        return undefined;
      }
    }
    return undefined;
  }
}
