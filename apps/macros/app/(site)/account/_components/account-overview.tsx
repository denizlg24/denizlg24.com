import { cn } from "@repo/ui/utils";
import { container, MoreLink } from "@/app/_landing/site";
import type { AccountDevice } from "@/lib/account/devices";
import { AccountShell } from "./account-shell";
import { AccountSection } from "./controls";
import { DeleteAccount } from "./delete-account";
import { DeviceList } from "./device-list";
import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";

const memberSince = new Intl.DateTimeFormat("en", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function AccountOverview({
  user,
  devices,
  drafts,
  published,
}: {
  user: { name: string; email: string; createdAt: Date };
  devices: AccountDevice[];
  drafts: number;
  published: number;
}) {
  const recipeCount = drafts + published;
  return (
    <AccountShell>
      <article className={cn(container, "pt-14 pb-24 sm:pt-20")}>
        <header className="max-w-2xl">
          <p className="eyebrow">Account</p>
          <h1 className="mt-4 text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.04] font-semibold tracking-[-0.04em] [overflow-wrap:anywhere]">
            {user.name}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Member since {memberSince.format(user.createdAt)}
          </p>
        </header>
        <div className="mt-14 flex max-w-2xl flex-col">
          <AccountSection id="profile" title="Profile">
            <ProfileForm name={user.name} email={user.email} />
          </AccountSection>
          <AccountSection id="password" title="Password">
            <PasswordForm email={user.email} />
          </AccountSection>
          <AccountSection id="devices" title="Devices">
            <DeviceList devices={devices} />
          </AccountSection>
          <AccountSection id="recipes" title="Your recipes">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
              <p className="text-[15px] text-muted-foreground tabular-nums">
                {recipeCount
                  ? `${plural(drafts, "draft", "drafts")} · ${published} published`
                  : "No recipes yet."}
              </p>
              {recipeCount ? (
                <MoreLink href="/kitchen">Open your recipes</MoreLink>
              ) : (
                <MoreLink href="/kitchen/new">Write a recipe</MoreLink>
              )}
            </div>
          </AccountSection>
          <AccountSection id="delete" title="Delete account">
            <DeleteAccount />
          </AccountSection>
        </div>
      </article>
    </AccountShell>
  );
}
