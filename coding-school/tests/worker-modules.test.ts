import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/**
 * Regression test: browsers reject ES modules that declare the same imported
 * binding twice (SyntaxError at worker construction), while the vitest
 * transform silently tolerates it — so unit tests stayed green while the real
 * browser Python worker was broken. Scan the shipped worker sources for
 * duplicate named-import bindings.
 */
function namedImportBindings(source: string): string[] {
  const names: string[] = [];
  const re = /import\s*\{([^}]+)\}\s*from\s*["'][^"']+["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    for (const part of match[1].split(",")) {
      const local = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (local) names.push(local);
    }
  }
  return names;
}

function duplicateBindings(file: string): string[] {
  const source = readFileSync(join(ROOT, file), "utf8");
  const names = namedImportBindings(source);
  return [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
}

describe("worker module imports", () => {
  const gradingFiles = readdirSync(join(ROOT, "public/grading"))
    .filter(file => file.endsWith(".js"))
    .map(file => `public/grading/${file}`);
  const files = ["public/python-worker.js", ...gradingFiles];

  it("declares no duplicate named-import bindings", () => {
    const offenders = files
      .map(file => ({ file, dupes: duplicateBindings(file) }))
      .filter(({ dupes }) => dupes.length > 0);
    expect(offenders).toEqual([]);
  });

  it("covers every shipped grading module", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain("public/grading/runner.js");
    expect(files).toContain("public/grading/protocol.js");
  });
});
