/** Theme constants and pure helpers shared by the server layout (the
 *  no-flash inline script) and the client hook. Kept free of "use client" so
 *  app/layout.tsx can import it without crossing a client boundary. */

export type ThemePreference = "light" | "dark";

export const THEME_STORAGE_KEY = "coding-school:theme";
export const THEME_ATTRIBUTE = "data-theme";
export const SYSTEM_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/** Monaco's built-in themes: `vs` for light, `vs-dark` (VS Code Dark+) for
 *  dark — VS Code-like Python syntax colours with light text. */
export const MONACO_THEMES = { light: "vs", dark: "vs-dark" } as const;

export type MonacoTheme = (typeof MONACO_THEMES)[ThemePreference];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark";
}

/** The stored preference wins; with nothing stored (or unreadable), the OS
 *  preference decides. Anything else stored falls back to the OS too. */
export function resolveTheme(stored: string | null | undefined, prefersDark: boolean): ThemePreference {
  return isThemePreference(stored) ? stored : prefersDark ? "dark" : "light";
}

export function monacoThemeFor(theme: ThemePreference): MonacoTheme {
  return MONACO_THEMES[theme];
}

/** Runs in <head> during HTML parsing, before the first paint: applies the
 *  saved preference, or the system preference when there is none, so the page
 *  never paints light-then-flashes-dark (and vice versa). */
export const THEME_INIT_SCRIPT = `(function(){try{var t=null;try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}if(t!=="light"&&t!=="dark"){t=(window.matchMedia&&window.matchMedia(${JSON.stringify(SYSTEM_SCHEME_QUERY)}).matches)?"dark":"light"}document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},t)}catch(e){document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},"light")}})()`;
