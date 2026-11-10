/** SET-2: the `.dark` class on the root element follows the operating system, with no switch. */
export function followSystemTheme(
  root: HTMLElement = document.documentElement,
): void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => root.classList.toggle("dark", query.matches);
  apply();
  query.addEventListener("change", apply);
}
