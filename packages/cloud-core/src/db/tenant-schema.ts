import { type InferSelectModel, relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { authUser } from "./auth-schema";

/**
 * Someone else's app that signs people in with deniz auth. Its clients carry
 * the tenant id in `auth_oauth_client.metadata.tenant`; its resources in
 * `auth_oauth_resource.tenant_id`.
 */
export const authTenant = pgTable("auth_tenant", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  homepageUrl: text("homepage_url"),
  privacyUrl: text("privacy_url"),
  termsUrl: text("terms_url"),
  signup: text("signup", { enum: ["open", "invite", "closed"] })
    .default("closed")
    .notNull(),
  mfa: text("mfa", { enum: ["required", "optional"] })
    .default("optional")
    .notNull(),
  requireVerifiedEmail: boolean("require_verified_email")
    .default(true)
    .notNull(),
  disabled: boolean("disabled").default(false).notNull(),
  createdBy: text("created_by").references(() => authUser.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** The developers who manage a tenant. The owner adds them; there is no self-service. */
export const authTenantMember = pgTable(
  "auth_tenant_member",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => authTenant.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin"] })
      .default("admin")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId] }),
    index("auth_tenant_member_user_idx").on(table.userId),
  ],
);

/** An account barred from one tenant's apps; every other app is unaffected. */
export const authTenantBlock = pgTable(
  "auth_tenant_block",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => authTenant.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    reason: text("reason"),
    createdBy: text("created_by").references(() => authUser.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.userId] })],
);

export const authTenantRelations = relations(authTenant, ({ many }) => ({
  members: many(authTenantMember),
  blocks: many(authTenantBlock),
}));

export const authTenantMemberRelations = relations(
  authTenantMember,
  ({ one }) => ({
    tenant: one(authTenant, {
      fields: [authTenantMember.tenantId],
      references: [authTenant.id],
    }),
    user: one(authUser, {
      fields: [authTenantMember.userId],
      references: [authUser.id],
    }),
  }),
);

export const authTenantBlockRelations = relations(
  authTenantBlock,
  ({ one }) => ({
    tenant: one(authTenant, {
      fields: [authTenantBlock.tenantId],
      references: [authTenant.id],
    }),
  }),
);

export type AuthTenant = InferSelectModel<typeof authTenant>;
export type AuthTenantMember = InferSelectModel<typeof authTenantMember>;
