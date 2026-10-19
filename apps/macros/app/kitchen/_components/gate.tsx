import Link from "next/link";
import type { ReactNode } from "react";
import { SignIn } from "@/app/_account/sign-in";
import { getPageSession } from "@/lib/api/page-session";
import styles from "./kitchen.module.css";

type Session = NonNullable<
  Awaited<ReturnType<typeof getPageSession>>["session"]
>;

export async function KitchenGate({
  children,
}: {
  children: (session: Session) => ReactNode | Promise<ReactNode>;
}) {
  const { session, suspended } = await getPageSession();
  if (session) return children(session);
  return (
    <div className={styles.gate}>
      <Link href="/recipes" className={styles.brand}>
        Macros Recipes
      </Link>
      {suspended ? (
        <p className={styles.gateNote}>
          This account is suspended and can’t write recipes. Contact{" "}
          <Link href="/support">support</Link> if you think this is a mistake.
        </p>
      ) : (
        <SignIn
          title="Sign in to write recipes"
          note="Use the same account as the Macros app. Recipes you write here show up on your phone too."
        />
      )}
    </div>
  );
}
