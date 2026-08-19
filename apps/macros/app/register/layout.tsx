import Image from "next/image"

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex min-h-svh w-full max-w-sm flex-col px-5">
        <header className="flex items-center gap-2 pb-7 pt-10">
          <Image
            src="/logo_transparent.png"
            alt="Macros"
            width={24}
            height={24}
            loading="eager"
            className="size-6"
          />
          <p className="text-sm font-semibold">Macros</p>
        </header>
        <section className="flex-1 pb-8">{children}</section>
      </div>
    </main>
  )
}
