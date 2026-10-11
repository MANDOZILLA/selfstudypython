"use client";

import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import {
  SYSTEM_SCHEME_QUERY, THEME_ATTRIBUTE, THEME_STORAGE_KEY,
  isThemePreference, resolveTheme,
  type ThemePreference,
} from "./theme-shared";

export {
  MONACO_THEMES, SYSTEM_SCHEME_QUERY, THEME_ATTRIBUTE, THEME_INIT_SCRIPT, THEME_STORAGE_KEY,
  isThemePreference, monacoThemeFor, resolveTheme,
} from "./theme-shared";
export type { MonacoTheme, ThemePreference } from "./theme-shared";

/** `useLayoutEffect` warns and does nothing during server rendering; swap it
 *  for `useEffect` there so `renderToStaticMarkup`/SSR stays quiet. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// The live theme lives on <html data-theme>, not in React state, so the
// inline script can set it before paint. This module-level store keeps every
// hook and editor in sync without a provider.
let themeSnapshot: ThemePreference = "light";
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getSnapshot = () => themeSnapshot;
const getServerSnapshot = (): ThemePreference => "light";

function commit(theme: ThemePreference) {
  if (themeSnapshot === theme) return;
  themeSnapshot = theme;
  listeners.forEach(listener => listener());
}

export function readStoredTheme(): string | null {
  try { return window.localStorage.getItem(THEME_STORAGE_KEY); } catch { return null; }
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia(SYSTEM_SCHEME_QUERY).matches;
}

export function applyTheme(theme: ThemePreference) {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
}

/** Resolve from storage/OS, apply to <html>, and publish to subscribers. */
export function syncTheme(): ThemePreference {
  const theme = resolveTheme(readStoredTheme(), systemPrefersDark());
  applyTheme(theme);
  commit(theme);
  return theme;
}

/** Persist an explicit choice (drops the "follow the system" behaviour). */
export function storeTheme(theme: ThemePreference) {
  try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* private mode: still applies for this session */ }
  applyTheme(theme);
  commit(theme);
}

export interface ThemeController {
  /** Resolved theme actually in use — never "system". */
  theme: ThemePreference;
  isDark: boolean;
  setTheme: (theme: ThemePreference) => void;
  toggleTheme: () => void;
}

/** Site-wide light/dark state. Server snapshot is always "light" so hydration
 *  matches the server markup; the first layout effect syncs with the value the
 *  inline script already painted. */
export function useTheme(): ThemeController {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useIsomorphicLayoutEffect(() => { syncTheme(); }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) syncTheme();
    };
    window.addEventListener("storage", onStorage);
    const query = typeof window.matchMedia === "function" ? window.matchMedia(SYSTEM_SCHEME_QUERY) : null;
    // Only follow the OS while the learner has not chosen a theme yet.
    const onSchemeChange = () => { if (readStoredTheme() === null) syncTheme(); };
    query?.addEventListener("change", onSchemeChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      query?.removeEventListener("change", onSchemeChange);
    };
  }, []);

  const setTheme = useCallback((next: ThemePreference) => { if (isThemePreference(next)) storeTheme(next); }, []);
  const toggleTheme = useCallback(() => { storeTheme(theme === "dark" ? "light" : "dark"); }, [theme]);

  return { theme, isDark: theme === "dark", setTheme, toggleTheme };
}

/** Accessible light/dark switch: a toggle button whose pressed state carries
 *  the current theme, so the state is available to screen readers as well as
 *  by sight. Render it anywhere in the site chrome. */
export function ThemeToggle({ className }: { className?: string }) {
  const { isDark, toggleTheme } = useTheme();
  return <button
    type="button"
    className={className ? `theme-toggle ${className}` : "theme-toggle"}
    aria-pressed={isDark}
    title={isDark ? "Switch to the light theme" : "Switch to the dark theme"}
    onClick={toggleTheme}
  >
    <span className="theme-toggle-icon" aria-hidden="true">{isDark ? "☾" : "☀"}</span>
    <span className="theme-toggle-text">Dark theme</span>
  </button>;
}
