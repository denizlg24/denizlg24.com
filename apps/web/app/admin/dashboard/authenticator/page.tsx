import { AuthenticatorPage } from "@repo/admin/authenticator/authenticator-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Authenticator | Admin Dashboard",
  description: "Manage TOTP authenticator accounts",
};

export default function AuthenticatorRoute() {
  return (
    <AdminFeatureShell>
      <AuthenticatorPage />
    </AdminFeatureShell>
  );
}
