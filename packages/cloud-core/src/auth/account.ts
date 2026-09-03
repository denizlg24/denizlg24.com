/**
 * Better Auth 1.7 keys accounts on an issuer alongside the provider id, built
 * as `local:${encodeURIComponent(providerId)}` for credential accounts and
 * `local:oauth:${...}` for social ones. The cloud only ever issues credential
 * accounts, so anything writing `auth_account` by hand uses this.
 */
export const CREDENTIAL_ACCOUNT_ISSUER = "local:credential";
