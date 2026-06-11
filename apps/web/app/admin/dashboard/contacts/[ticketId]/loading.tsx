export default function ContactDetailsLoading() {
  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300">
      <div className="flex flex-col items-start gap-1">
        <h1 className="text-2xl sm:text-3xl font-bold">Contact details</h1>
      </div>
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground animate-pulse">
        Loading contact...
      </div>
    </div>
  );
}
