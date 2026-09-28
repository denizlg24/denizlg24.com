import { Redirect } from "expo-router";

/** Deep links (`macros://verified`, `macros://sign-in`) that the current auth state has no screen for. */
export default function NotFound() {
  return <Redirect href="/" />;
}
