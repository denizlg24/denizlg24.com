"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { MongoPanel } from "./_components/mongo-panel";
import { PostgresPanel } from "./_components/postgres-panel";
import { ToolsPanel } from "./_components/tools-panel";

export default function DatabasesPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-sm font-semibold">databases</h1>
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
