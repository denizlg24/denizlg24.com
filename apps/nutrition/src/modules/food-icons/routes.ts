import { Elysia, t } from "elysia";

import { db } from "../../db/client";
import { ApiError } from "../../shared/errors";
import { ok } from "../../shared/http";
import { getRequestContext } from "../../shared/request-context";
import { FoodIconsRepository } from "./repository";

const repository = new FoodIconsRepository(db);

const getRequestId = (request: Request) =>
  getRequestContext(request)?.requestId ?? "unknown";

const withDataUrl = (icon: {
  key: string;
  foodGroup: string;
  mediaType: string;
  imageBase64: string;
  updatedAt: Date;
}) => ({
  ...icon,
  dataUrl: `data:${icon.mediaType};base64,${icon.imageBase64}`,
});

export const foodIconsRoutes = new Elysia({ prefix: "/food-icons" })
  .get(
    "/",
    async ({ request }) => ok(await repository.list(), getRequestId(request)),
    {
      detail: {
        summary: "List food icons",
        description:
          "Returns lightweight icon metadata. Items reference these assets by iconKey.",
        tags: ["Food icons"],
      },
    },
  )
  .get(
    "/:key",
    async ({ params, request }) => {
      const icon = await repository.findByKey(params.key);

      if (!icon) {
        throw new ApiError(404, "FOOD_ICON_NOT_FOUND", "Food icon not found");
      }

      return ok(withDataUrl(icon), getRequestId(request));
    },
    {
      params: t.Object({
        key: t.String({ minLength: 1, maxLength: 128 }),
      }),
      detail: {
        summary: "Get food icon",
        tags: ["Food icons"],
      },
    },
  );
