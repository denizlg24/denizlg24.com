import { Redirect } from "expo-router";

/** The sign-in redirect; ASWebAuthenticationSession normally catches it first. */
export default function OAuthCallback() {
  return <Redirect href="/" />;
}
