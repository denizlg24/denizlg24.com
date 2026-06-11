import { CommandPalette } from "@/components/navigation/command-palette";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="pt-8 h-screen flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      <CommandPalette />
    </main>
  );
}
