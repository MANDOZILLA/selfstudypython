#!/usr/bin/env node
/**
 * One-command setup for Coding School.
 *
 *   node scripts/setup.mjs                  install deps + prepare the editor
 *   node scripts/setup.mjs --check           verify only, change nothing
 *   node scripts/setup.mjs --with-browsers   also install Playwright Chromium
 *                                            (only needed for verify:* runs)
 *
 * Run from anywhere: the app directory is resolved from this file's location.
 * Safe to re-run: install steps are skipped when already up to date.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MIN_NODE_MAJOR = 20;
export const MIN_NODE_MINOR_FOR_20 = 9;

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

/** Parse "v24.14.0" (or "24.14.0") into {major, minor, patch}; null if garbage. */
export function parseNodeVersion(versionString) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(versionString ?? "").trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Node 20.9+ required: major > 20 passes, major 20 needs minor >= 9. */
export function isSupportedVersion(versionString) {
  const parsed = parseNodeVersion(versionString);
  if (!parsed) return false;
  if (parsed.major > MIN_NODE_MAJOR) return true;
  if (parsed.major === MIN_NODE_MAJOR) return parsed.minor >= MIN_NODE_MINOR_FOR_20;
  return false;
}

/** True when node_modules is missing or older than the lockfile.
 *  Compares against the marker npm writes last on every install
 *  (node_modules/.package-lock.json), not the directory mtime, which can
 *  tie with the lockfile when both are written in the same second. */
export function needsInstall(appDir = APP_DIR) {
  const marker = resolve(appDir, "node_modules", ".package-lock.json");
  const lockfile = resolve(appDir, "package-lock.json");
  if (!existsSync(marker) || !existsSync(lockfile)) return true;
  try {
    return statSync(lockfile).mtimeMs > statSync(marker).mtimeMs;
  } catch {
    return true;
  }
}

function step(label, command, args, options = {}) {
  console.log(`\n[setup] ${label}…`);
  // Spawning a .cmd on Windows requires a shell.
  const shell = process.platform === "win32" && /\.cmd$/i.test(command);
  execFileSync(command, args, { cwd: APP_DIR, stdio: "inherit", shell, ...options });
}

function fail(message) {
  console.error(`\n[setup] ERROR: ${message}`);
  process.exit(1);
}

export function runSetup({ checkOnly = false, withBrowsers = false } = {}) {
  console.log(`[setup] Checking environment (app dir: ${APP_DIR})`);

  if (!isSupportedVersion(process.versions.node)) {
    fail(
      `Node.js ${process.versions.node} found, but Node ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR_FOR_20}+ is required. ` +
        "On Windows, double-click Start-Coding-School.bat and it downloads a working Node automatically.",
    );
  }
  console.log(`[setup] Node ${process.versions.node} OK`);

  if (checkOnly) {
    if (needsInstall()) fail("dependencies are not installed — run: node scripts/setup.mjs");
    console.log("[setup] Dependencies OK. Everything is ready.");
    return;
  }

  if (needsInstall()) {
    step("Installing dependencies (npm ci)", NPM, ["ci"]);
  } else {
    console.log("[setup] Dependencies already installed, skipping npm ci");
  }

  step("Preparing the editor", process.execPath, ["scripts/prepare-editor.mjs"]);

  if (withBrowsers) {
    step("Installing Playwright Chromium (for verify:* runs)", NPX, ["playwright", "install", "chromium"]);
  } else {
    console.log("[setup] Skipping browser download (only needed for verify:* runs; re-run with --with-browsers)");
  }

  console.log("\n[setup] Done. Start the school with: npm run dev");
}

const invokedAsScript = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  runSetup({
    checkOnly: process.argv.includes("--check"),
    withBrowsers: process.argv.includes("--with-browsers"),
  });
}
