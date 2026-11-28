-- Bind the helper when this function is created so pg_dump records the
-- dependency and pg_restore can rebuild generated columns with an empty search_path.
CREATE OR REPLACE FUNCTION public.stream_fold_list(value text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
RETURN public.stream_fold(pg_catalog.array_to_string(value, ' | '));
