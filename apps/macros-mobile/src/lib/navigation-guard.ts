import { router } from "expo-router";

const REPEAT_WINDOW_MS = 400;

let lastAcceptedAt = Number.NEGATIVE_INFINITY;
let batchOpen = false;

/**
 * A second tap lands before the first navigation has visibly happened, and
 * opens the same sheet twice or pops two screens. Calls made in the same
 * tick are one action (close, then open) and all pass; a new one inside the
 * window is dropped.
 */
function accept(): boolean {
  if (batchOpen) return true;
  const now = Date.now();
  if (now - lastAcceptedAt < REPEAT_WINDOW_MS) return false;
  lastAcceptedAt = now;
  batchOpen = true;
  setTimeout(() => {
    batchOpen = false;
  }, 0);
  return true;
}

let installed = false;

/**
 * `useRouter()` returns this same object, so guarding it once covers every
 * navigation in the app, including screens added later.
 */
export function installNavigationGuard() {
  if (installed) return;
  installed = true;
  const { push, navigate, replace, back, dismiss, dismissAll, dismissTo } =
    router;
  router.push = (href, options) => {
    if (accept()) push(href, options);
  };
  router.navigate = (href, options) => {
    if (accept()) navigate(href, options);
  };
  router.replace = (href, options) => {
    if (accept()) replace(href, options);
  };
  router.back = () => {
    if (accept()) back();
  };
  router.dismiss = (count) => {
    if (accept()) dismiss(count);
  };
  router.dismissAll = () => {
    if (accept()) dismissAll();
  };
  router.dismissTo = (href, options) => {
    if (accept()) dismissTo(href, options);
  };
}
