import { NowPage } from "@repo/admin/now/now-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function NowPageAdmin() {
  return (
    <AdminFeatureShell>
      <NowPage />
    </AdminFeatureShell>
  );
}
