/**
 * Tools that stay registered under their own name in the compact surface
 * instead of being reached through the catalog. The catalog's call tools are
 * split by kind, so a client that grants `catalog_read` or `catalog_write`
 * wholesale grants every operation of that kind; these are the operations
 * such a grant must never include, plus the one whose outbound effect wants
 * its own name on the approval prompt.
 */
export const DIRECT_TOOLS: Readonly<Record<string, string>> = {
  cloud_run_command: "runs an arbitrary command on the Pi",
  cloud_pg_query: "runs arbitrary SQL",
  forge_resource_credentials_reveal: "reveals resource credentials",
  cloud_project_search_token: "mints a search token",
  cloud_project_api_key_create: "mints an API key",
  cloud_project_api_key_rotate: "replaces a live API key",
  cloud_project_s3_credential_create: "mints an S3 credential",
  cloud_project_s3_credential_rotate: "replaces a live S3 credential",
  cloud_user_set_password: "changes a sign-in credential",
  cloud_user_reset_mfa: "removes a second factor",
  web_api_keys: "mints and revokes admin API keys",
  web_authenticator: "returns live TOTP codes from a read-only action",
  web_emails: "sends mail to other people",
  web_workspace_surfaces:
    "writes code that runs in the owner's browser with the full tool bridge",
};

export function isDirectTool(name: string): boolean {
  return Object.hasOwn(DIRECT_TOOLS, name);
}
