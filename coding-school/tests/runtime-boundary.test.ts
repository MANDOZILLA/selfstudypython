import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Runtime-boundary trace: server-only modules must never be imported from
 * client-rendered code paths. This is the static half of the verification
 * stage; the browser stages confirm no secret reaches the page at runtime.
 *
 * Boundaries:
 * - lib/server/** and app/api/** route modules are server-only: they may
 *   touch OPENROUTER_API_KEY and the SQLite file. No component/, page, or
 *   other client module may import them.
 * - No client-rendered module may reference process.env secrets directly.
 * - Public worker bundles (public/grading/**, public/python-worker/**) must
 *   not reference OPENROUTER or fetch credentials.
 */
const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "pyodide") continue;
      walk(full, out);
    } else if (/\.[jt]sx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(ROOT);
const rel = (f: string) => relative(ROOT, f);

/** Explicit allowlist of server-only modules. A module is server-only because
 *  it is on this list or lives under a server-only path — never because of
 *  a comment it carries about itself. */
const SERVER_ONLY_PREFIXES = ["lib/server/", "db/"];
const SERVER_ONLY_FILES = new Set(["lib/tutor-provider.ts"]);

function isServerOnly(f: string): boolean {
  const r = rel(f).replace(/\\/g, "/");
  if (
    SERVER_ONLY_PREFIXES.some(prefix => r.startsWith(prefix)) ||
    SERVER_ONLY_FILES.has(r) ||
    /app\/api\/.*\/route\.(ts|js)$/.test(r)
  ) return true;
  return false;
}

function isClientRendered(f: string): boolean {
  const r = rel(f).replace(/\\/g, "/");
  return (
    r.startsWith("components/") ||
    r.startsWith("app/") && !isServerOnly(f) ||
    r.startsWith("public/grading/") ||
    r.startsWith("public/python-worker/") ||
    r.startsWith("lib/") && !r.startsWith("lib/server/")
  );
}

function importsOf(f: string): string[] {
  const src = readFileSync(f, "utf8");
  const out: string[] = [];
  const re = /(?:import|from)\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1] ?? m[2]);
  return out;
}

describe("runtime boundaries", () => {
  it("client code never imports server-only modules", () => {
    const violations: string[] = [];
    for (const f of allFiles.filter(isClientRendered)) {
      for (const imp of importsOf(f)) {
        const normalized = imp.replace(/^(\.\.\/|\.\/)+/, "");
        if (
          normalized.startsWith("lib/server") ||
          normalized.startsWith("db/") ||
          normalized.includes("app/api") ||
          normalized.endsWith("/openrouter")
        ) {
          violations.push(`${rel(f)} imports ${imp}`);
        }
      }
    }
    expect(violations, "server-only imports from client code").toEqual([]);
  });

  it("no client-rendered module references secret environment variables", () => {
    const secretRe = /process\.env\.(OPENROUTER_API_KEY|TUTOR_MODEL|[\w]*(?:SECRET|KEY|TOKEN|PASSWORD)[\w]*)/;
    const violations = allFiles
      .filter(f => isClientRendered(f) && !isServerOnly(f))
      .filter(f => !/\.test\.|tests\//.test(rel(f)))
      .filter(f => secretRe.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(violations, "secret env reads in client code").toEqual([]);
  });

  it("public worker bundles carry no credentials or tutor secrets", () => {
    const violations: string[] = [];
    for (const f of allFiles) {
      const r = rel(f).replace(/\\/g, "/");
      if (!r.startsWith("public/grading/") && !r.startsWith("public/python-worker/") && r !== "public/python-worker.js") continue;
      const src = readFileSync(f, "utf8");
      if (/OPENROUTER|api\/tutor/i.test(src)) violations.push(r);
    }
    expect(violations, "tutor wiring inside worker bundles").toEqual([]);
  });

  it("tutor client reaches only the same-origin API route", () => {
    const client = allFiles.find(f => rel(f).replace(/\\/g, "/") === "app/studio/tutor-panel.tsx")
      ?? allFiles.find(f => /tutor/i.test(rel(f)) && isClientRendered(f) && !isServerOnly(f));
    if (client) {
      const src = readFileSync(client, "utf8");
      const urls = [...src.matchAll(/https?:\/\/[^\s"'`]+/g)].map(m => m[0]);
      const external = urls.filter(u => !u.startsWith("https://openrouter.ai") && !u.includes("localhost"));
      expect(external, "external URLs in tutor client").toEqual([]);
      expect(src.includes("openrouter.ai"), "tutor client must not call OpenRouter directly").toBe(false);
    }
  });
});
