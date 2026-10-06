"use client";

import { errorMessage, isApiError } from "@repo/cloud-ui/api-error";
import type { TenantMember, TenantMemberRole } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { RadioGroup, RadioGroupItem } from "@repo/ui/radio-group";
import { Spinner } from "@repo/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { tenantsApi } from "@/lib/tenants-api";
import { StackedRow, When } from "./account-parts";
import { PageSection, SectionEmpty } from "./shell-frame";
import {
  canAdminister,
  OwnerOnlyNote,
  ROLE_OPTIONS,
  type TenantAccess,
} from "./tenant-parts";
import { describedBy, FormField } from "./tenant-profile-fields";

function roleFrom(value: string): TenantMemberRole {
  return (
    ROLE_OPTIONS.find((option) => option.value === value)?.value ?? "admin"
  );
}

function roleLabel(role: TenantMemberRole): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

function memberName(member: TenantMember): string {
  return member.name || member.username || member.email;
}

function AddMemberDialog({
  open,
  slug,
  appName,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  slug: string;
  appName: string;
  onOpenChange: (open: boolean) => void;
  onAdded: () => Promise<void>;
}) {
  const [account, setAccount] = useState("");
  const [role, setRole] = useState<TenantMemberRole>("admin");
  const [accountError, setAccountError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const handle = account.trim();
    if (!handle) {
      setAccountError("Enter their username or email address.");
      return;
    }
    setAccountError(undefined);
    setFormError(null);
    setBusy(true);
    try {
      await tenantsApi.addMember(slug, { account: handle, role });
      setAccount("");
      setRole("admin");
      onOpenChange(false);
      await onAdded();
    } catch (error) {
      if (isApiError(error) && error.status === 404) {
        setAccountError(
          "No deniz account has that username or email. They need an account before they can join.",
        );
      } else {
        setFormError(errorMessage(error));
      }
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base">Add a member</DialogTitle>
          <DialogDescription>
            Someone who builds {appName}. They manage it here, signed in with
            their own deniz account, and need two-factor turned on to do it.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-5">
          <FormField
            id="member-account"
            label="Username or email"
            error={accountError}
          >
            <Input
              id="member-account"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={255}
              value={account}
              aria-invalid={accountError ? true : undefined}
              aria-describedby={describedBy(
                "member-account",
                accountError,
                false,
              )}
              onChange={(event) => setAccount(event.target.value)}
            />
          </FormField>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Role</legend>
            <RadioGroup
              value={role}
              onValueChange={(next) => setRole(roleFrom(next))}
              className="gap-3"
            >
              {ROLE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  htmlFor={`member-role-${option.value}`}
                  className="flex cursor-pointer items-start gap-3"
                >
                  <RadioGroupItem
                    id={`member-role-${option.value}`}
                    value={option.value}
                    className="mt-0.5"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm text-accent-strong">
                      {option.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {option.detail}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          {formError ? (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" aria-busy={busy || undefined} disabled={busy}>
              {busy ? <Spinner aria-hidden="true" /> : null}
              Add member
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemberActions({
  member,
  self,
  appName,
  manage,
  soleOwner,
  busy,
  onSetRole,
  onRemove,
}: {
  member: TenantMember;
  self: boolean;
  appName: string;
  manage: boolean;
  soleOwner: boolean;
  busy: boolean;
  onSetRole: (role: TenantMemberRole) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const name = memberName(member);
  const otherRole: TenantMemberRole =
    member.role === "owner" ? "admin" : "owner";
  // Demoting the last owner would leave nobody able to change the app's
  // settings or team, and the API does not refuse it.
  const canChangeRole = manage && !(member.role === "owner" && soleOwner);
  const canRemove = manage || self;

  return (
    <>
      {canChangeRole ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void onSetRole(otherRole)}
        >
          Make {roleLabel(otherRole).toLowerCase()}
        </Button>
      ) : null}
      {canRemove ? (
        <ConfirmButton
          trigger={
            <Button size="sm" variant="ghost" disabled={busy}>
              {self ? "Leave" : "Remove"}
            </Button>
          }
          title={self ? `Leave ${appName}?` : `Remove ${name}?`}
          description={
            self
              ? `You stop managing ${appName} straight away. An owner can add you back.`
              : `${name} stops managing ${appName} straight away. Their deniz account is untouched.`
          }
          actionLabel={self ? "Leave" : "Remove"}
          onConfirm={onRemove}
        />
      ) : null}
    </>
  );
}

export function TenantMembers({
  slug,
  appName,
  access,
  members,
  selfId,
  onChanged,
  onLeft,
}: {
  slug: string;
  appName: string;
  access: TenantAccess;
  members: TenantMember[];
  selfId: string;
  onChanged: () => Promise<void>;
  onLeft: () => Promise<void>;
}) {
  const manage = canAdminister(access);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const owners = members.filter((member) => member.role === "owner").length;

  const act = async (member: TenantMember, action: () => Promise<void>) => {
    setBusyId(member.userId);
    try {
      await action();
    } catch (error) {
      toast.error(errorMessage(error));
    }
    setBusyId(null);
  };

  const setRole = (member: TenantMember, role: TenantMemberRole) =>
    act(member, async () => {
      await tenantsApi.addMember(slug, { account: member.email, role });
      await onChanged();
    });

  const remove = (member: TenantMember) =>
    act(member, async () => {
      await tenantsApi.removeMember(slug, member.userId);
      // Leaving as a member ends access to this page; the owner of the whole
      // service keeps it either way.
      if (member.userId === selfId && access !== "superuser") {
        await onLeft();
        return;
      }
      await onChanged();
    });

  const actionsFor = (member: TenantMember) => (
    <MemberActions
      member={member}
      self={member.userId === selfId}
      appName={appName}
      manage={manage}
      soleOwner={owners === 1}
      busy={busyId === member.userId}
      onSetRole={(role) => setRole(member, role)}
      onRemove={() => remove(member)}
    />
  );

  const addButton = (variant: "default" | "outline") => (
    <Button
      size={variant === "default" ? "sm" : "default"}
      variant={variant}
      disabled={!manage}
      onClick={() => setAdding(true)}
    >
      Add member
    </Button>
  );

  return (
    <PageSection
      title="Members"
      count={members.length}
      actions={members.length > 0 ? addButton("default") : null}
    >
      {manage ? null : (
        <OwnerOnlyNote>
          Only an owner of this app can add members or change their roles.
        </OwnerOnlyNote>
      )}
      {members.length === 0 ? (
        <SectionEmpty action={manage ? addButton("outline") : null}>
          Nobody is on {appName}'s team yet. Add the people who build it so they
          can manage its clients and users with their own deniz accounts.
        </SectionEmpty>
      ) : (
        <>
          <ul className="flex flex-col sm:hidden">
            {members.map((member) => (
              <StackedRow
                key={member.userId}
                title={
                  <>
                    <span className="truncate">{memberName(member)}</span>
                    {member.userId === selfId ? (
                      <Badge variant="outline">You</Badge>
                    ) : null}
                  </>
                }
                detail={
                  <>
                    {roleLabel(member.role)}
                    {" · "}
                    <span className="break-all">{member.email}</span>
                  </>
                }
                actions={actionsFor(member)}
              />
            ))}
          </ul>
          <Table containerClassName="hidden sm:block">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden md:table-cell">Added</TableHead>
                <TableHead className="sr-only">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell className="max-w-56">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-accent-strong">
                        {memberName(member)}
                      </span>
                      {member.userId === selfId ? (
                        <Badge variant="outline">You</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                    {member.email}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {roleLabel(member.role)}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    <When value={member.createdAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {actionsFor(member)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      {manage ? (
        <AddMemberDialog
          open={adding}
          slug={slug}
          appName={appName}
          onOpenChange={setAdding}
          onAdded={onChanged}
        />
      ) : null}
    </PageSection>
  );
}
