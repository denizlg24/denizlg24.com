"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import styles from "./kitchen.module.css";

export function SignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      className={styles.ghostButton}
      onClick={async () => {
        await authClient.signOut();
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
