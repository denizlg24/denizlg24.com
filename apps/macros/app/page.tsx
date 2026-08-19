import { headers } from "next/headers"
import Image from "next/image"
import { redirect } from "next/navigation"

import { AuthForm } from "@/app/_components/auth-form"
import { pageMetadata } from "@/app/metadata"
import { auth } from "@/lib/auth"

export const metadata = pageMetadata(
  "Sign in",
  "Sign in to Macros to track food logs, recipes, micronutrients, and weight trends."
)

export default async function Page() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (session) {
    redirect("/app")
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex min-h-svh w-full max-w-sm flex-col px-5 pb-8">
        <header className="flex items-center gap-2 pt-10 pb-7">
          <Image
            src="/logo_transparent.png"
            alt="Macros"
            width={24}
            height={24}
            className="size-6"
          />
          <p className="text-sm font-semibold">Macros</p>
        </header>

        <section className="flex-1">
          <AuthForm />
        </section>

        <footer className="border-t pt-4 text-center text-xs leading-5 text-muted-foreground">
          Your free macro tracker. Built by{" "}
          <a href="https://denizlg24.com" className="underline">
            denizlg24.com
          </a>
        </footer>
      </div>
    </main>
  )
}
