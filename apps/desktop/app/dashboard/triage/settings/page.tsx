"use client";

import { Brain, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type {
  ITriageCategoryRouting,
  ITriageSettings,
  TriageCategory,
} from "@/lib/data-types";
import { CategoryBadge } from "../_components/category-badge";
import { TriageLoadingSkeleton } from "../_components/triage-loading-skeleton";

const CATEGORIES: TriageCategory[] = [
  "action-needed",
  "purchases",
  "scheduled",
  "fyi",
  "newsletter",
  "promo",
  "spam",
];

function defaultRouting(): ITriageCategoryRouting {
  return {
    autoCreateCard: false,
    autoAcceptThreshold: 0.85,
  };
}

export default function TriageSettingsPage() {
  const { settings: userSettings, loading: loadingSettings } =
    useUserSettings();
  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(userSettings.apiKey);
  }, [userSettings, loadingSettings]);

  const [data, setData] = useState<ITriageSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    const res = await api.GET<{ settings: ITriageSettings }>({
      endpoint: "triage/settings",
    });
    if ("code" in res) toast.error("Failed to load settings");
    else setData(res.settings);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateRouting = (
    cat: TriageCategory,
    patch: Partial<ITriageCategoryRouting>,
  ) => {
    if (!data) return;
    setData({
      ...data,
      categoryRouting: {
        ...data.categoryRouting,
        [cat]: {
          ...(data.categoryRouting[cat] ?? defaultRouting()),
          ...patch,
        },
      },
    });
  };

  const handleSave = async () => {
    if (!api || !data) return;
    setSaving(true);
    const res = await api.PATCH<{ settings: ITriageSettings }>({
      endpoint: "triage/settings",
      body: {
        enabled: data.enabled,
        runIntervalMinutes: data.runIntervalMinutes,
        prefilterModel: data.prefilterModel,
        fullModel: data.fullModel,
        categoryRouting: data.categoryRouting,
      },
    });
    setSaving(false);
    if ("code" in res) {
      toast.error("Failed to save");
      return;
    }
    toast.success("Saved");
    setData(res.settings);
  };

  if (loadingSettings || (loading && !data)) {
    return <TriageLoadingSkeleton />;
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-4 pb-8 h-full overflow-y-auto">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Brain className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Triage Settings</span>
        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Save
        </Button>
      </div>

      <div className="px-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-xs font-medium">Enabled</Label>
            <p className="text-[11px] text-muted-foreground">
              Run triage on new emails automatically.
            </p>
          </div>
          <Switch
            checked={data.enabled}
            onCheckedChange={(v) => setData({ ...data, enabled: v })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Interval (minutes)</Label>
            <Input
              type="number"
              min={15}
              value={data.runIntervalMinutes}
              onChange={(e) =>
                setData({
                  ...data,
                  runIntervalMinutes: Number(e.target.value),
                })
              }
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Prefilter model</Label>
            <Input
              value={data.prefilterModel}
              onChange={(e) =>
                setData({ ...data, prefilterModel: e.target.value })
              }
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <Label className="text-xs">Full triage model</Label>
            <Input
              value={data.fullModel}
              onChange={(e) => setData({ ...data, fullModel: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
        </div>

        <Separator />

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Category Automation
          </p>
          <p className="text-[11px] text-muted-foreground mb-3">
            Kanban board and column targets are inferred during triage from your
            current boards.
          </p>
          <div className="flex flex-col gap-4">
            {CATEGORIES.map((cat) => {
              const r = data.categoryRouting[cat] ?? defaultRouting();
              return (
                <div
                  key={cat}
                  className="border rounded-md p-3 flex flex-col gap-3"
                >
                  <div className="flex items-center gap-2">
                    <CategoryBadge category={cat} />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[11px]">Auto-create card</Label>
                    <Switch
                      checked={r.autoCreateCard}
                      onCheckedChange={(v) =>
                        updateRouting(cat, { autoCreateCard: v })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between">
                      <Label className="text-[11px]">
                        Task auto-accept threshold
                      </Label>
                      <span className="text-[11px] tabular-nums">
                        {(r.autoAcceptThreshold * 100).toFixed(0)}%
                      </span>
                    </div>
                    <Slider
                      min={0.5}
                      max={1.0}
                      step={0.05}
                      value={[r.autoAcceptThreshold]}
                      onValueChange={([v]) =>
                        updateRouting(cat, { autoAcceptThreshold: v })
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
