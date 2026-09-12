import { create } from "zustand";

export type AuthStatus = "loading" | "signed-out" | "signed-in";

/** Where an in-progress sign-in is: waiting on the browser, or on the token endpoint. */
export type SignInPhase = "idle" | "waiting" | "exchanging";

type AuthState = {
  status: AuthStatus;
  signIn: SignInPhase;
  error: string | null;
};

export const useAuthStore = create<AuthState>(() => ({
  status: "loading",
  signIn: "idle",
  error: null,
}));
