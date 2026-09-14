-- `GET /storage/recent` orders every file the caller can see by its newest
-- timestamp. Without this the query sorts the whole table on every open of
-- the Recent page.
CREATE INDEX IF NOT EXISTS "files_recent_idx" ON "files" (greatest("created_at", "updated_at") DESC);
