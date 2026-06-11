export default function ContactsLoading() {
  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold">Contacts</h1>
      </div>
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground animate-pulse">
        Loading contacts...
      </div>
    </div>
  );
}
