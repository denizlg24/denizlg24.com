export default function EditBlogLoading() {
  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold">Edit Blog Post</h1>
      </div>
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground animate-pulse">
        Loading blog...
      </div>
    </div>
  );
}
