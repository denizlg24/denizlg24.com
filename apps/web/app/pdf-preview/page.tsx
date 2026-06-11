import { PDFMarkdownRenderer } from "@/components/pdf-markdown-renderer";
import { Separator } from "@/components/ui/separator";
export default async function AdminNotesPdfPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const {
    content: contentParam,
    title: contentTitle,
    showHeader,
  } = await searchParams;
  const content = decodeURIComponent(contentParam || "");
  const title = decodeURIComponent(contentTitle || "");
  return (
    <div className="w-full flex flex-col items-center -mt-26">
      {showHeader && (
        <>
          <div className="w-full max-w-7xl flex flex-row justify-between items-center gap-2 font-calistoga pt-2">
            <p className="text-xs pl-3">denizlg24</p>
            <p className="text-xs font-mono">{title}.md</p>
            <p className="text-xs pr-3">{new Date().toLocaleDateString()}</p>
          </div>
          <Separator className="my-1 w-full" />
        </>
      )}
      <div className="w-full max-w-full! mx-auto bg-background p-6">
        <PDFMarkdownRenderer content={content} />
      </div>
    </div>
  );
}
