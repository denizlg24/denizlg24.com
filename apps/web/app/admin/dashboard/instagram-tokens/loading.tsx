export default function InstagramTokensLoading() {
  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in duration-300">
      <h1 className="text-2xl sm:text-3xl font-bold">Instagram Tokens</h1>
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground animate-pulse">
        Loading tokens...
      </div>
    </div>
  );
}
