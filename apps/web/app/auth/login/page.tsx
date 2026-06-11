import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/get-server-session";
import { LoginForm } from "./login-form";

export default async function Page() {
  const session = await getServerSession();
  if (session) {
    redirect("/admin/dashboard");
  }

  return (
    <main className="w-full flex flex-col items-center">
      <section className="w-full mx-auto max-w-5xl">
        <h1 className="sm:text-5xl text-4xl font-calistoga font-bold text-center">
          login.
        </h1>
        <LoginForm />
      </section>
    </main>
  );
}
