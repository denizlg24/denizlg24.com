import { llmModelsResponseSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { CatalogUnavailableError } from "@/lib/llm-errors";
import { listModels } from "@/lib/llm-service";
import { requireAdmin } from "@/lib/require-admin";

// Authenticated model-catalog endpoint for the web/desktop model selectors.
// It only relays the service's Gateway catalog view: language models with
// optional creator/capability filters. Never proxies arbitrary URLs.

const ALLOWED_QUERY_KEYS = new Set(["creator", "requiredCapability"]);

export interface ModelCatalogRouteDependencies {
  requireAdmin(request?: NextRequest): Promise<NextResponse | null>;
  listModels: typeof listModels;
}

const defaultDependencies: ModelCatalogRouteDependencies = {
  requireAdmin,
  listModels,
};

export const getModelCatalogResponse = async (
  req: NextRequest,
  dependencies: ModelCatalogRouteDependencies = defaultDependencies,
) => {
  const adminError = await dependencies.requireAdmin(req);
  if (adminError) return adminError;

  const params = req.nextUrl.searchParams;
  for (const key of params.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      return NextResponse.json(
        { error: `Unknown filter "${key}"` },
        { status: 400 },
      );
    }
  }

  const creator = params.get("creator") ?? undefined;
  const requiredTags = params.getAll("requiredCapability");

  try {
    const { models, stale, fetchedAt } = await dependencies.listModels({
      creator,
      requiredTags,
    });

    const body = llmModelsResponseSchema.parse({
      models: models.map((model) => ({
        id: model.id,
        name: model.name,
        creator: model.creator,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        tags: model.tags,
        ...(model.pricing
          ? {
              pricing: {
                input: model.pricing.input,
                output: model.pricing.output,
              },
            }
          : {}),
      })),
      stale,
      fetchedAt: fetchedAt.toISOString(),
    });

    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof CatalogUnavailableError) {
      return NextResponse.json(
        { error: "Model catalog is temporarily unavailable" },
        { status: 503 },
      );
    }
    console.error("Model catalog route error:", error);
    return NextResponse.json(
      { error: "Failed to list models" },
      { status: 500 },
    );
  }
};

export const GET = (req: NextRequest) => getModelCatalogResponse(req);
