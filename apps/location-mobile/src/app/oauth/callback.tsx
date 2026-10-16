import { Redirect } from "expo-router";

/**
 * The sign-in redirect. ASWebAuthenticationSession catches it before the app
 * sees it; this only answers a stray open of the link.
 */
export default function OAuthCallback() {
  return <Redirect href="/" />;
}
