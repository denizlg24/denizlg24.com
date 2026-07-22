import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const { searchOpenAlex } = await import("./openalex");

describe("searchOpenAlex", () => {
  it("caps semantic queries and excludes retracted works", async () => {
    let requestedUrl = "";
    const suggestions = await searchOpenAlex("x".repeat(2_500), {
      fetchImpl: (async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return Response.json({
          results: [
            {
              id: "https://openalex.org/W1",
              title: "Retracted",
              is_retracted: true,
            },
            {
              id: "https://openalex.org/W2",
              title: "Useful work",
              publication_year: 2025,
              is_retracted: false,
              primary_location: {
                source: {
                  display_name: "Proceedings of Test",
                  host_organization_name: "Test Publisher",
                },
              },
              open_access: { is_oa: true, oa_status: "gold" },
              relevance_score: 0.75,
            },
          ],
        });
      }) as typeof fetch,
    });
    const requested = new URL(requestedUrl);
    expect(requested.searchParams.get("search.semantic")?.length).toBe(2_000);
    expect(requested.searchParams.get("filter")).toBe("is_retracted:false");
    expect(requested.searchParams.get("per_page")).toBe("20");
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      openAlexId: "W2",
      isOpenAccess: true,
      venue: "Proceedings of Test",
      publisher: "Test Publisher",
    });
  });
});
