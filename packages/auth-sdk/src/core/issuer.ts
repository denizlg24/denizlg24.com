export const DEFAULT_ISSUER = "https://api.denizlg24.com/api/auth";

/** `openid` for the identity, `offline_access` for a refresh token. */
export const DEFAULT_SCOPE = "openid offline_access";

export interface IssuerEndpoints {
  issuer: string;
  authorization: string;
  token: string;
  revocation: string;
  jwks: string;
}

export function normalizeIssuer(issuer: string | undefined): string {
  return (issuer ?? DEFAULT_ISSUER).replace(/\/+$/, "");
}

export function issuerEndpoints(issuer?: string): IssuerEndpoints {
  const base = normalizeIssuer(issuer);
  return {
    issuer: base,
    authorization: `${base}/oauth2/authorize`,
    token: `${base}/oauth2/token`,
    revocation: `${base}/oauth2/revoke`,
    jwks: `${base}/jwks`,
  };
}
