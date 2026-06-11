"use client";

import { Eye, EyeOff, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ITimelineItemLean } from "@/models/TimelineItem";
import { TimelineList } from "./timeline-list";

interface TimelineManagerProps {
  initialItems: ITimelineItemLean[];
}

export function TimelineManager({ initialItems }: TimelineManagerProps) {
  const [items, setItems] = useState<ITimelineItemLean[]>(initialItems);
  const [filteredItems, setFilteredItems] =
    useState<ITimelineItemLean[]>(initialItems);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<string>("all");
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const fetchItems = async () => {
    try {
      const response = await fetch("/api/admin/timeline");
      if (!response.ok) {
        throw new Error("Failed to fetch timeline items");
      }
      const data = await response.json();
      setItems(data.items || []);
    } catch (error) {
      console.error("Error fetching timeline items:", error);
    }
  };

  useEffect(() => {
    let filtered = items;

    if (activeCategory !== "all") {
      filtered = filtered.filter((item) => item.category === activeCategory);
    }

    if (visibilityFilter !== "all") {
      filtered = filtered.filter((item) =>
        visibilityFilter === "visible" ? item.isActive : !item.isActive,
      );
    }

    setFilteredItems(filtered);
    setHasUnsavedChanges(false);
  }, [items, activeCategory, visibilityFilter]);

  const handleReorder = (newItems: ITimelineItemLean[]) => {
    setFilteredItems(newItems);
    setHasUnsavedChanges(true);
  };

  const handleSaveOrder = async () => {
    setSaving(true);
    try {
      const itemsWithNewOrder = filteredItems.map((item, index) => ({
        _id: item._id,
        order: index,
      }));

      const response = await fetch("/api/admin/timeline/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsWithNewOrder }),
      });

      if (!response.ok) {
        throw new Error("Failed to save order");
      }

      await fetchItems();
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error("Error saving order:", error);
      alert("Failed to save order. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex sm:flex-row flex-col sm:items-center items-start gap-2 justify-between w-full">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">
            Timeline Management
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Create and manage your timeline cards displayed on the homepage.
            {activeCategory !== "all" && " Drag items to reorder them."}
          </p>
        </div>
        <div className="flex gap-2 sm:w-fit w-full">
          {hasUnsavedChanges && (
            <Button
              variant="default"
              onClick={handleSaveOrder}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Order"}
            </Button>
          )}
          <Button asChild>
            <Link href="/admin/dashboard/timeline/new">
              <Plus className="w-4 h-4 mr-2" />
              Create New
            </Link>
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Tabs
            value={activeCategory}
            onValueChange={setActiveCategory}
            className="flex-1"
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="work">Work</TabsTrigger>
              <TabsTrigger value="education">Education</TabsTrigger>
              <TabsTrigger value="personal">Personal</TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            variant={visibilityFilter === "hidden" ? "default" : "outline"}
            size="icon"
            onClick={() =>
              setVisibilityFilter(
                visibilityFilter === "hidden" ? "all" : "hidden",
              )
            }
            title={
              visibilityFilter === "hidden" ? "Show All" : "Show Hidden Only"
            }
          >
            {visibilityFilter === "hidden" ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </Button>
        </div>

        <Tabs value={activeCategory}>
          <TabsContent value={activeCategory} className="mt-0">
            <TimelineList
              items={filteredItems}
              onRefresh={fetchItems}
              enableReorder={activeCategory !== "all"}
              onReorder={handleReorder}
            />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
