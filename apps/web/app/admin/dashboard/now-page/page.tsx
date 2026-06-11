import { forbidden } from "next/navigation";
import { getNowPageContent } from "@/lib/now-page";
import { getAdminSession } from "@/lib/require-admin";
import { NowPageEditor } from "./_components/now-page-editor";

export default async function NowPageAdmin() {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
  }

  const doc = await getNowPageContent();

  return (
    <div className="mx-auto space-y-6">
      <NowPageEditor
        initialContent={doc?.content || ""}
        lastUpdated={
          doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null
        }
      />
    </div>
  );
}
