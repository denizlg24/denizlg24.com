/** Mirrors the OS colour scheme onto the `.dark` class that @repo/ui's tokens key off. */
export function watchColorScheme(): () => void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");

  const apply = (dark: boolean) => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  };

  apply(query.matches);
  const listener = (event: MediaQueryListEvent) => apply(event.matches);
  query.addEventListener("change", listener);

  return () => query.removeEventListener("change", listener);
}
