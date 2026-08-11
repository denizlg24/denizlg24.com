"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { MongoPanel } from "./_components/mongo-panel";
import { PostgresPanel } from "./_components/postgres-panel";
import { ToolsPanel } from "./_components/tools-panel";

/**
 * The daemons, not the databases on them. What a database *is* — who connects
 * to it, with which credentials, from which project — is a resource, and
 * resources live in Forge. This is process health, what each engine is
 * carrying, and the introspection tools that have no equivalent there.
 */
export default function EnginesPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-sm font-semibold">engines</h1>
      <Tabs defaultValue="postgres">
        <TabsList variant="line">
          <TabsTrigger value="postgres" className="text-xs">
            postgres
          </TabsTrigger>
          <TabsTrigger value="mongodb" className="text-xs">
            mongodb
          </TabsTrigger>
          <TabsTrigger value="tools" className="text-xs">
            tools
          </TabsTrigger>
        </TabsList>
        <TabsContent value="postgres" className="pt-4">
          <PostgresPanel />
        </TabsContent>
        <TabsContent value="mongodb" className="pt-4">
          <MongoPanel />
        </TabsContent>
        <TabsContent value="tools" className="pt-4">
          <ToolsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
