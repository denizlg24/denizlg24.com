import { sql } from "drizzle-orm";

import type { Database } from "../../db/client";
import type { MeilisearchSearchClient } from "../../infra/meilisearch";
import {
  buildSearchDocument,
  type SearchableRow,
  searchableColumnsSql,
  searchableWhereSql,
} from "./document";

/**
 * Pushes rows the API itself writes into the index right away. Bulk imports
 * go through `search:sync` instead; this API is the index's only writer.
 */
export class SearchIndexer {
  constructor(
    private readonly database: Database,
    private readonly search: MeilisearchSearchClient,
  ) {}

  async index(itemIds: string[]) {
    if (itemIds.length === 0) return;
    const { rows } = await this.database.execute<SearchableRow>(
      sql`select ${sql.raw(searchableColumnsSql)} from items
           where id in (${sql.join(
             itemIds.map((id) => sql`${id}`),
             sql`, `,
           )}) and ${sql.raw(searchableWhereSql)}`,
    );
    await this.search.addDocuments(rows.map(buildSearchDocument));
  }
}
