import { z } from "zod";
import { CatalogUnavailableError } from "@/lib/llm-errors";

// Dynamic model discovery against the Vercel AI Gateway catalog. The endpoint
// is unauthenticated; generation credentials are validated elsewhere and only
// when a generation actually starts.

const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const RETRY_BASE_DELAY_MS = 200;
const RETRY_JITTER_MS = 300;

// Upstream prices are USD-per-token decimal strings.
const upstreamPricingSchema = z
  .object({
    input: z.string().optional(),
    output: z.string().optional(),
    input_cache_read: z.string().optional(),
    input_cache_write: z.string().optional(),
    input_tiers: z.unknown().optional(),
    output_tiers: z.unknown().optional(),
  })
  .loose();

const upstreamModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string().optional(),
    owned_by: z.string(),
    type: z.string(),
    tags: z.array(z.string()).optional(),
    context_window: z.number().optional(),
    max_tokens: z.number().optional(),
    pricing: upstreamPricingSchema.optional(),
  })
  .loose();

const upstreamCatalogSchema = z.object({
  data: z.array(z.unknown()),
});

export interface GatewayModelPricing {
  /** USD per input token. */
  input?: number;
  /** USD per output token. */
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Upstream published volume tiers; base prices above remain estimates. */
  hasTiers: boolean;
}

export interface GatewayModel {
  id: string;
  name: string;
  description?: string;
  /** Model creator (`owned_by`) — not the serving provider. */
  creator: string;
  type: string;
  tags: string[];
  contextWindow?: number;
  maxTokens?: number;
  pricing?: GatewayModelPricing;
}

export interface ModelFilter {
  creator?: string;
  requiredTags?: string[];
  /** Defaults to "language"; pass null to disable type filtering. */
  type?: string | null;
}

export interface CatalogResult {
  models: GatewayModel[];
  fetchedAt: Date;
  /** True when this data outlived its TTL because a refresh failed. */
  stale: boolean;
}

interface CatalogState {
  models: GatewayModel[];
  fetchedAt: number;
}

let lastGood: CatalogState | null = null;
let inFlight: Promise<CatalogState> | null = null;

function parsePrice(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toGatewayModel(entry: unknown): GatewayModel | null {
  const parsed = upstreamModelSchema.safeParse(entry);
  if (!parsed.success) return null;
  const model = parsed.data;
  const pricing = model.pricing
    ? {
        input: parsePrice(model.pricing.input),
        output: parsePrice(model.pricing.output),
        cacheRead: parsePrice(model.pricing.input_cache_read),
        cacheWrite: parsePrice(model.pricing.input_cache_write),
        hasTiers:
          model.pricing.input_tiers !== undefined ||
          model.pricing.output_tiers !== undefined,
      }
    : undefined;

  return {
    id: model.id,
    name: model.name,
    description: model.description,
    creator: model.owned_by,
    type: model.type,
    tags: model.tags ?? [],
    contextWindow: model.context_window,
    maxTokens: model.max_tokens,
    pricing,
  };
}

function parseCatalogBody(body: unknown): GatewayModel[] {
  const parsed = upstreamCatalogSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Gateway catalog body did not match the expected shape");
  }

  const models: GatewayModel[] = [];
  let dropped = 0;
  for (const entry of parsed.data.data) {
    const model = toGatewayModel(entry);
    if (model) {
      models.push(model);
    } else {
      dropped += 1;
    }
  }

  if (models.length === 0) {
    throw new Error("Gateway catalog contained no valid models");
  }
  if (dropped > 0) {
    console.warn(`[llm-catalog] Dropped ${dropped} malformed catalog entries`);
  }
  return models;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCatalog(): Promise<CatalogState> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(GATEWAY_MODELS_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        next: { revalidate: 900 },
      });
      if (!response.ok) {
        throw new Error(`Gateway catalog responded ${response.status}`);
      }
      const models = parseCatalogBody(await response.json());
      const state: CatalogState = { models, fetchedAt: Date.now() };
      lastGood = state;
      return state;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await sleep(RETRY_BASE_DELAY_MS + Math.random() * RETRY_JITTER_MS);
      }
    }
  }
  throw lastError;
}

/**
 * Returns the cached catalog, refreshing when the TTL lapsed. Concurrent
 * refreshes share one in-flight request; a failed refresh serves the last
 * good copy (marked stale) and only a cold start with no copy at all throws.
 */
export async function getCatalog(): Promise<CatalogResult> {
  if (lastGood && Date.now() - lastGood.fetchedAt < CACHE_TTL_MS) {
    return {
      models: lastGood.models,
      fetchedAt: new Date(lastGood.fetchedAt),
      stale: false,
    };
  }

  if (!inFlight) {
    inFlight = fetchCatalog().finally(() => {
      inFlight = null;
    });
  }

  try {
    const state = await inFlight;
    return {
      models: state.models,
      fetchedAt: new Date(state.fetchedAt),
      stale: false,
    };
  } catch (error) {
    if (lastGood) {
      return {
        models: lastGood.models,
        fetchedAt: new Date(lastGood.fetchedAt),
        stale: true,
      };
    }
    throw new CatalogUnavailableError(
      `Gateway model catalog is unavailable: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
}

function compareModels(left: GatewayModel, right: GatewayModel): number {
  return (
    left.creator.localeCompare(right.creator) ||
    left.name.localeCompare(right.name)
  );
}

export async function listModels(filter?: ModelFilter): Promise<CatalogResult> {
  const { models, fetchedAt, stale } = await getCatalog();
  const type = filter?.type === undefined ? "language" : filter.type;
  const requiredTags = filter?.requiredTags ?? [];

  const filtered = models
    .filter((model) => {
      if (type !== null && model.type !== type) return false;
      if (filter?.creator && model.creator !== filter.creator) return false;
      return requiredTags.every((tag) => model.tags.includes(tag));
    })
    .sort(compareModels);

  return { models: filtered, fetchedAt, stale };
}

/** Looks a model up by exact id. Throws CatalogUnavailableError on a cold catalog. */
export async function findModel(id: string): Promise<GatewayModel | null> {
  const { models } = await getCatalog();
  return models.find((model) => model.id === id) ?? null;
}

export function __resetCatalogForTests(): void {
  lastGood = null;
  inFlight = null;
}
