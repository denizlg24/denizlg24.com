"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { API_BASE_URL } from "@/lib/env";

function ToolFrame({ tool }: { tool: string }) {
  return (
    <iframe
      src={`${API_BASE_URL}/api/ops/tools/${tool}`}
      title={tool}
      className="h-[calc(100dvh-16rem)] w-full rounded border bg-white"
    />
  );
}

export function ToolsPanel() {
  return (
    <Tabs defaultValue="adminer">
      <TabsList variant="line">
        <TabsTrigger value="adminer" className="text-xs">
          adminer
        </TabsTrigger>
        <TabsTrigger value="mongo-express" className="text-xs">
          mongo-express
        </TabsTrigger>
      </TabsList>
      <TabsContent value="adminer" className="pt-3">
        <ToolFrame tool="adminer" />
      </TabsContent>
      <TabsContent value="mongo-express" className="pt-3">
        <ToolFrame tool="mongo-express" />
      </TabsContent>
    </Tabs>
  );
}
