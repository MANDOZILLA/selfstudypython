import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSupportedVersion, needsInstall, parseNodeVersion } from "../scripts/setup.mjs";

describe("parseNodeVersion", () => {
  it("parses v-prefixed and bare versions", () => {
    expect(parseNodeVersion("v24.14.0")).toEqual({ major: 24, minor: 14, patch: 0 });
    expect(parseNodeVersion("20.9.1")).toEqual({ major: 20, minor: 9, patch: 1 });
  });
  it("returns null for garbage", () => {
    expect(parseNodeVersion("")).toBeNull();
    expect(parseNodeVersion("not-a-version")).toBeNull();
    expect(parseNodeVersion("v20")).toBeNull();
  });
});

describe("isSupportedVersion", () => {
  it("accepts Node 20.9+ and anything newer", () => {
    expect(isSupportedVersion("v20.9.0")).toBe(true);
    expect(isSupportedVersion("v20.19.0")).toBe(true);
    expect(isSupportedVersion("v22.0.0")).toBe(true);
    expect(isSupportedVersion("v24.14.0")).toBe(true);
  });
  it("rejects older or unparsable versions", () => {
    expect(isSupportedVersion("v20.8.9")).toBe(false);
    expect(isSupportedVersion("v18.20.0")).toBe(false);
    expect(isSupportedVersion("v16.0.0")).toBe(false);
    expect(isSupportedVersion("garbage")).toBe(false);
  });
});

describe("needsInstall", () => {
  function makeAppDir({ withMarker, lockNewer }: { withMarker: boolean; lockNewer: boolean }): string {
    const dir = mkdtempSync(join(tmpdir(), "setup-test-"));
    writeFileSync(join(dir, "package-lock.json"), "{}");
    if (withMarker) {
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      writeFileSync(join(dir, "node_modules", ".package-lock.json"), "{}");
    }
    // Control relative mtimes: default both to now, then age one side.
    const now = new Date();
    const old = new Date(now.getTime() - 60_000);
    utimesSync(join(dir, "package-lock.json"), now, lockNewer ? now : old);
    if (withMarker) utimesSync(join(dir, "node_modules", ".package-lock.json"), now, lockNewer ? old : now);
    return dir;
  }

  it("needs install when node_modules is missing", () => {
    expect(needsInstall(makeAppDir({ withMarker: false, lockNewer: true }))).toBe(true);
  });
  it("needs install when the lockfile is newer than the install marker", () => {
    expect(needsInstall(makeAppDir({ withMarker: true, lockNewer: true }))).toBe(true);
  });
  it("skips install when the marker is up to date", () => {
    expect(needsInstall(makeAppDir({ withMarker: true, lockNewer: false }))).toBe(false);
  });
});
