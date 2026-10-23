import { Redirect } from "expo-router";

/**
 * The sign-in redirect. The auth session catches it before the app sees it;
 * this only answers a stray open of the link (Android also hands it to the router).
 */
export default function OAuthCallback() {
  return <Redirect href="/" />;
}
