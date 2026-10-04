import { Elysia } from "elysia";

import { db } from "../../db/client";
import { meilisearch } from "../../infra/meilisearch";
import { redis } from "../../infra/redis";
import { isApiError } from "../../shared/errors";
import { fail, ok } from "../../shared/http";
import { getRequestContext } from "../../shared/request-context";
import { OpenFoodFactsLiveLookup } from "../openfoodfacts/live";
import { SearchIndexer } from "../search/indexer";
import { ItemsRepository } from "./repository";
import {
  barcodeParamsSchema,
  createItemSchema,
  itemIdParamsSchema,
  nutritionPayloadSchema,
  searchQuerySchema,
  updateItemSchema,
} from "./schemas";
import { ItemsService } from "./service";

const getRequestId = (request: Request) =>
  getRequestContext(request)?.requestId ?? "unknown";

const toApiErrorResponse = (
  error: unknown,
  request: Request,
  set: {
    status?: number | string;
  },
) => {
  if (!isApiError(error)) {
    throw error;
  }

  set.status = error.statusCode;

  return fail(
    {
      code: error.code,
      message: error.message,
      details: error.details,
    },
    getRequestId(request),
  );
};

const repository = new ItemsRepository(db, meilisearch);
const indexer = new SearchIndexer(db, meilisearch);
const service = new ItemsService(
  repository,
  new OpenFoodFactsLiveLookup(db, indexer, redis),
  indexer,
);

export const itemsRoutes = new Elysia({ prefix: "/items" })
  .get(
    "/search",
    async ({ query, request }) =>
      ok(
        await service.search(
          {
            query: query.q,
            brand: query.brand,
          },
          query.lang ?? "english",
          query.limit,
          query.minScore,
        ),
        getRequestId(request),
      ),
    {
      query: searchQuerySchema,
      detail: {
        summary: "Search items",
        description:
          "Full-text search by item name, brand, or both. The requested language is prioritized in ranking.",
        tags: ["Items"],
      },
    },
  )
  .get(
    "/barcode/:barcode",
    async ({ params, request, set }) => {
      try {
        return ok(
          await service.getByBarcode(params.barcode),
          getRequestId(request),
        );
      } catch (error) {
        return toApiErrorResponse(error, request, set);
      }
    },
    {
      params: barcodeParamsSchema,
      detail: {
        summary: "Get item by barcode",
        description:
          "Accepts any GTIN spelling (EAN-8, UPC-E, UPC-A, EAN-13, GTIN-14). A merged duplicate resolves to the row it was merged into; a code the catalog lacks is fetched from OpenFoodFacts and stored.",
        tags: ["Items"],
      },
    },
  )
  .get(
    "/:id",
    async ({ params, request }) =>
      ok(await service.getById(params.id), getRequestId(request)),
    {
      params: itemIdParamsSchema,
      detail: {
        summary: "Get item summary",
        tags: ["Items"],
      },
    },
  )
  .get(
    "/:id/portions",
    async ({ params, request }) =>
      ok(await service.getPortions(params.id), getRequestId(request)),
    {
      params: itemIdParamsSchema,
      detail: {
        summary: "Get item household portions",
        description:
          "Household measures with gram weights, as published by the item's composition table.",
        tags: ["Items"],
      },
    },
  )
  .get(
    "/:id/nutrition",
    async ({ params, request }) =>
      ok(await service.getNutrition(params.id), getRequestId(request)),
    {
      params: itemIdParamsSchema,
      detail: {
        summary: "Get item nutrition",
        tags: ["Items"],
      },
    },
  )
  .post(
    "/",
    async ({ body, request, set }) => {
      set.status = 201;
      return ok(await service.create(body), getRequestId(request));
    },
    {
      body: createItemSchema,
      detail: {
        summary: "Create item",
        description:
          "Creates an item and its first nutrition payload. Quick summary fields are derived from nutrition.",
        tags: ["Items"],
      },
    },
  )
  .put(
    "/:id",
    async ({ params, body, request }) =>
      ok(await service.update(params.id, body), getRequestId(request)),
    {
      body: updateItemSchema,
      params: itemIdParamsSchema,
      detail: {
        summary: "Update item core fields",
        description:
          "Updates mutable item identity fields. Nutrition summary fields are managed from nutrition data.",
        tags: ["Items"],
      },
    },
  )
  .put(
    "/:id/nutrition",
    async ({ params, body, request }) =>
      ok(await service.updateNutrition(params.id, body), getRequestId(request)),
    {
      body: nutritionPayloadSchema,
      params: itemIdParamsSchema,
      detail: {
        summary: "Update item nutrition",
        description:
          "Upserts full nutrition data and refreshes the quick item summary in one transaction.",
        tags: ["Items"],
      },
    },
  );
