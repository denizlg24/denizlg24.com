import Link from "next/link";
import type { ReactNode } from "react";
import { getPageSession } from "@/lib/api/page-session";
import styles from "./kitchen.module.css";
import { SignIn } from "./sign-in";

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
        <SignIn />
      )}
    </div>
  );
}
