"use client";

import {
  type ComponentBinding,
  type ComponentProp,
  type ComponentPropValues,
  dataQueryResultSchema,
  RECORD_REFS_MAX,
  recordsResponseSchema,
  viewQueryResultSchema,
} from "@repo/schemas";
import type { SpecScope } from "@repo/utils/ui-spec";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminClient } from "../../client";
import { useAdmin } from "../../provider";

const REFRESH_MS = 5 * 60_000;

async function loadBinding(
  client: AdminClient,
  binding: ComponentBinding,
  today: string,
): Promise<unknown> {
  switch (binding.kind) {
    case "collection":
      return dataQueryResultSchema.parse(
        await client.post("workspace/data/query", binding.query),
      );
    case "json":
      return binding.value;
    case "records": {
      if (binding.refs.length === 0) return [];
      const refs = binding.refs.slice(0, RECORD_REFS_MAX);
      const { records } = recordsResponseSchema.parse(
        await client.get(
          `workspace/records?refs=${encodeURIComponent(refs.join(","))}`,
        ),
      );
      return records;
    }
    case "view": {
      const result = viewQueryResultSchema.parse(
        await client.post("workspace/views/query", {
          view: binding.view,
          today,
        }),
      );
      return {
        rows: result.rows.map((row) => ({
          id: row.id,
          ref: row.ref,
          ...row.values,
        })),
        total: result.total,
        totals: result.totals,
        groups: result.groups,
      };
    }
  }
}

export type ComponentData = {
  scope: SpecScope;
  loading: boolean;
  errors: Record<string, string>;
  /** Loads every binding again, after an action changed what they read. */
  reload: () => void;
};

/** Every binding loaded into one scope, plus `props` and `today`; refreshed every few minutes. */
export function useComponentData(
  bindings: ComponentBinding[],
  propDefs: ComponentProp[],
  propValues: ComponentPropValues,
): ComponentData {
  const { client } = useAdmin();
  const key = JSON.stringify(bindings);
  const [loaded, setLoaded] = useState<{
    values: Record<string, unknown>;
    errors: Record<string, string>;
    loading: boolean;
  }>({ values: {}, errors: {}, loading: bindings.length > 0 });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let live = true;
    const today = format(new Date(), "yyyy-MM-dd");
    setLoaded((s) => ({ ...s, loading: true }));
    void Promise.all(
      bindings.map(async (binding) => {
        try {
          return [
            binding.name,
            await loadBinding(client, binding, today),
            null,
          ] as const;
        } catch (error) {
          return [
            binding.name,
            undefined,
            error instanceof Error ? error.message : "Failed",
          ] as const;
        }
      }),
    ).then((entries) => {
      if (!live) return;
      const values: Record<string, unknown> = {};
      const errors: Record<string, string> = {};
      for (const [name, value, error] of entries) {
        if (error) errors[name] = error;
        else values[name] = value;
      }
      setLoaded({ values, errors, loading: false });
    });
    return () => {
      live = false;
    };
  }, [client, key, tick]);

  const scope = useMemo<SpecScope>(() => {
    const props: Record<string, unknown> = {};
    for (const def of propDefs) {
      props[def.name] = propValues[def.name] ?? def.default ?? "";
    }
    return {
      ...loaded.values,
      props,
      today: format(new Date(), "yyyy-MM-dd"),
      now: new Date().toISOString(),
    };
  }, [loaded.values, propDefs, propValues]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { scope, loading: loaded.loading, errors: loaded.errors, reload };
}
