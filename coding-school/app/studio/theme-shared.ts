/** Theme constants and pure helpers shared by the server layout (the
 *  no-flash inline script) and the client hook. Kept free of "use client" so
 *  app/layout.tsx can import it without crossing a client boundary. */

export type ThemePreference = "light" | "dark";

export const THEME_STORAGE_KEY = "coding-school:theme";
export const THEME_ATTRIBUTE = "data-theme";
export const SYSTEM_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/** Monaco's built-in themes: `vs` for light, `vs-dark` (VS Code Dark+) for
 *  dark — VS Code-like Python syntax colours with light text. */
export const MONACO_THEMES = { light: "snakepit-light", dark: "snakepit-dark" } as const;

export type MonacoTheme = (typeof MONACO_THEMES)[ThemePreference];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark";
}

/** The stored preference wins; otherwise start in dark mode. */
export function resolveTheme(stored: string | null | undefined, prefersDark: boolean): ThemePreference {
  void prefersDark; // New installs start in dark mode; retain the parameter for API compatibility.
  return isThemePreference(stored) ? stored : "dark";
}

export function defineSnakepitThemes(monaco: typeof import("monaco-editor")) {
  monaco.editor.defineTheme("snakepit-dark", { base: "vs-dark", inherit: true, rules: [
    { token: "keyword", foreground: "22E6FF" }, { token: "string", foreground: "5CFF9D" },
    { token: "number", foreground: "A78BFA" }, { token: "function", foreground: "FFB300" },
    { token: "comment", foreground: "8A9DB3", fontStyle: "italic" },
  ], colors: { "editor.background": "#070b11", "editorCursor.foreground": "#22e6ff", "editor.lineHighlightBackground": "#22e6ff0c", "editorLineNumber.foreground": "#526274" } });
  monaco.editor.defineTheme("snakepit-light", { base: "vs", inherit: true, rules: [
    { token: "keyword", foreground: "0077A3" }, { token: "string", foreground: "0F7A3D" },
    { token: "number", foreground: "5B3FC4" }, { token: "function", foreground: "8A5A00" },
    { token: "comment", foreground: "4A5D6E", fontStyle: "italic" },
  ], colors: { "editor.background": "#f4f7fa", "editorCursor.foreground": "#0077a3", "editor.lineHighlightBackground": "#0077a30c", "editorLineNumber.foreground": "#718394" } });
}

export function monacoThemeFor(theme: ThemePreference): MonacoTheme {
  return MONACO_THEMES[theme];
}

/** Runs in <head> during HTML parsing, before the first paint: applies the
 *  saved preference, or the system preference when there is none, so the page
 *  never paints light-then-flashes-dark (and vice versa). */
export const THEME_INIT_SCRIPT = `(function(){var t="dark";try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(s==="light"||s==="dark")t=s}catch(e){}document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},t)})()`;
