import { titleIdSchema } from "@repo/schemas/stream";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { type MapFocus, TasteMap } from "@/components/map/taste-map";
import { TopBar } from "@/components/top-bar";
import { db } from "@/db";
import { titles } from "@/db/schema";
import { audienceProfiles, requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Map" };

async function findFocus(
  raw: string | string[] | undefined,
): Promise<MapFocus | null> {
  const id = titleIdSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  if (!id.success) return null;
  const row = await db.query.titles.findFirst({
    where: eq(titles.id, id.data),
    columns: { id: true, mapX: true, mapY: true, title: true },
  });
  return row
    ? { id: row.id, x: row.mapX, y: row.mapY, title: row.title }
    : null;
}

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { focus } = await searchParams;
  const viewer = await requireViewer(
    typeof focus === "string"
      ? `/map?focus=${encodeURIComponent(focus)}`
      : "/map",
  );
  if (viewer.layout === "classic") redirect("/");
  const audience = audienceProfiles(viewer);
  return (
    <div className="relative h-dvh overflow-hidden">
      <TasteMap
        audience={audience.map(({ id, name, color, kids }) => ({
          id,
          name,
          color,
          kids,
        }))}
        focus={await findFocus(focus)}
      />
      <TopBar audience={audience} layout="studio" overlay />
    </div>
  );
}
