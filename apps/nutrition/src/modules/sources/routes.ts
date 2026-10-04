import { Elysia } from "elysia";

import { ok } from "../../shared/http";
import { getRequestContext } from "../../shared/request-context";
import { sourceCatalog } from "./catalog";

export const sourcesRoutes = new Elysia({ prefix: "/sources" }).get(
  "/",
  ({ request }) =>
    ok(sourceCatalog, getRequestContext(request)?.requestId ?? "unknown"),
  {
    detail: {
      summary: "List data sources",
      description:
        "Every dataset served, with the licence and citation it requires.",
      tags: ["System"],
    },
  },
);
