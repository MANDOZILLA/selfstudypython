import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeToggle } from "../app/studio/theme";
import {
  MONACO_THEMES, THEME_INIT_SCRIPT, THEME_STORAGE_KEY, isThemePreference, monacoThemeFor, resolveTheme,
} from "../app/studio/theme-shared";

const readSource = (file: string) => readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8");

describe("resolveTheme", () => {
  it("prefers a valid stored choice over the system preference", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
  it("defaults to dark when nothing usable is stored", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("dark");
    expect(resolveTheme(undefined, true)).toBe("dark");
    expect(resolveTheme("banana", true)).toBe("dark");
    expect(resolveTheme("banana", false)).toBe("dark");
  });
  it("only accepts light/dark as preferences", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe("Monaco theme mapping", () => {
  it("uses the custom Snakepit themes for both appearances", () => {
    expect(MONACO_THEMES).toEqual({ light: "snakepit-light", dark: "snakepit-dark" });
    expect(monacoThemeFor("dark")).toBe("snakepit-dark");
    expect(monacoThemeFor("light")).toBe("snakepit-light");
  });

  it("keeps every non-diagnostic editor on the shared theme instead of a hardcoded one", () => {
    for (const file of ["studio/ide-pane.tsx", "studio/assessment-workbench.tsx"]) {
      const source = readSource(file);
      expect(source, `${file} must not hardcode a Monaco theme`).not.toMatch(/theme="(light|vs|vs-dark)"/);
      expect(source, `${file} must derive its Monaco theme from useTheme()`).toContain("monacoThemeFor(");
    }
  });
});

describe("no-flash inline script", () => {
  it("reads the saved choice and otherwise defaults to dark", () => {
    expect(THEME_INIT_SCRIPT).toContain(`localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})`);
    expect(THEME_INIT_SCRIPT).toContain('var t="dark"');
    expect(THEME_INIT_SCRIPT).toContain('setAttribute("data-theme"');
    // Always leaves data-theme set, even when storage is unavailable.
    expect(THEME_INIT_SCRIPT).toContain('setAttribute("data-theme",t)');
  });

  it("is shipped by the root layout before the body paints", () => {
    const layout = readSource("layout.tsx");
    expect(layout).toContain("THEME_INIT_SCRIPT");
    expect(layout).toMatch(/<head>[\s\S]*dangerouslySetInnerHTML=\{\{ __html: THEME_INIT_SCRIPT \}\}[\s\S]*<\/head>/);
    expect(layout).toContain("suppressHydrationWarning");
  });
});

describe("ThemeToggle", () => {
  const html = renderToStaticMarkup(<ThemeToggle />);

  it("is a labelled toggle button announcing its pressed state", () => {
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Daylight");
    expect(html).toContain("Switch to daylight");
  });

  it("renders the dark default during SSR so hydration matches", () => {
    expect(html).toContain("Daylight");
  });
});
