import { PageHeader } from "@repo/ui/page-header";
import type { ReactNode } from "react";

export function AdminPageHeader({
  icon,
  title,
  leading,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <PageHeader
      icon={icon}
      title={title}
      leading={leading}
      className="-mx-3 px-3 sm:-mx-4 sm:px-4"
    >
      {children}
    </PageHeader>
  );
}
