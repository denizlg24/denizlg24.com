import { useSyncExternalStore } from "react";
import type { AuthState, NativeAuth } from "./session";

export function useAuthState(auth: NativeAuth): AuthState {
  return useSyncExternalStore(auth.subscribe, auth.getState, auth.getState);
}
