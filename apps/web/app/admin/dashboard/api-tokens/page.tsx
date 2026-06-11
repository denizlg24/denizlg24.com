import { format } from "date-fns";
import { Plus, RefreshCw, Settings, Trash } from "lucide-react";
import { forbidden } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { connectDB } from "@/lib/mongodb";
import { getAdminSession } from "@/lib/require-admin";
import ApiKey from "@/models/ApiKey";
import { CreateKeyDialog } from "./_components/create-key-dialog";
import { DeleteKeyDialog } from "./_components/delete-key-dialog";
import { EditKeyDialog } from "./_components/edit-key-dialog";

export default async function Page() {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
  }

  await connectDB();
  const tokens = await ApiKey.find().lean();

  if (!tokens || tokens.length === 0) {
    return (
      <div className="w-full flex flex-col gap-6">
        <h1 className="text-2xl sm:text-3xl font-bold">Api Keys</h1>
        <div>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Settings className="w-12 h-12 text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>No API Keys Yet</EmptyTitle>
              <EmptyDescription>
                You don't have any long term tokens yet.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <div className="flex gap-2">
                <CreateKeyDialog>
                  <Button>Create your first API key</Button>
                </CreateKeyDialog>
              </div>
            </EmptyContent>
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-6">
      <div className="w-full flex flex-row items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold">API Keys</h1>
        <CreateKeyDialog>
          <Button variant="outline" size="icon-sm">
            <Plus />
          </Button>
        </CreateKeyDialog>
      </div>

      <div className="w-full flex flex-col gap-2">
        {tokens.map((token) => (
          <div
            key={token._id.toString()}
            className="p-4 border border-border rounded-md flex flex-row items-center justify-between gap-2"
          >
            <div className="flex flex-col sm:flex-row sm:items-center gap-1">
              <span className="font-mono text-sm break-all">{token.name}</span>
              <span className="text-xs text-muted-foreground">
                {format(new Date(token.createdAt), "Pp")}
              </span>
            </div>
            <div className="flex flex-row gap-1">
              <DeleteKeyDialog id={token._id.toString()}>
                <Button size="icon-sm" variant={"outline"}>
                  <Trash />
                </Button>
              </DeleteKeyDialog>

              <EditKeyDialog id={token._id.toString()}>
                <Button size="icon-sm" variant={"outline"}>
                  <RefreshCw />
                </Button>
              </EditKeyDialog>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
