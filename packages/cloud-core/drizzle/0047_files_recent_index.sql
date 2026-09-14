-- `GET /storage/recent` orders every file the caller can see by its newest
-- timestamp; without this the query sorts the whole table on each open.
CREATE INDEX "files_recent_idx" ON "files" USING btree (greatest("created_at", "updated_at") DESC);