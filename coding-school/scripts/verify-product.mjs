#!/usr/bin/env node
/**
 * Whole-product verification: one command, fourteen stages, fail fast.
 *
 *   npm run verify:product
 *
 * Stages, in order:
 *   1. unit tests                    (npx vitest run)
 *   2. curriculum validation         (tests/curriculum-validation.test.ts)
 *   3. grader mutation tests        (tests/grader-mutation.test.ts)
 *   4. sqlite repo/migration/security(tests/sqlite.test.ts)
 *   5. typescript                    (npx tsc --noEmit)
 *   6. eslint                        (npx eslint)
 *   7. production build              (npm run build)
 *   8. runtime-boundary trace        (tests/runtime-boundary.test.ts)
 *   9. diagnostic browser flow       (scripts/verify-diagnostic.mjs)
 *  10. mission browser flow          (scripts/verify-missions.mjs)
 *  11. portfolio export / ZIP       (tests/zip-export.test.ts)
 *  12. tutor fallback + Learn Mode  (scripts/verify-tutor.mjs)
 *  13. desktop 1280x720 journey     (scripts/verify-desktop.mjs)
 *  14. mobile 375x812 journey       (scripts/verify-mobile.mjs)
 *
 * Rules:
 * - Fail fast: the first failed stage stops the remaining stages.
 * - No silent skips: every stage runs its command; a stage that cannot run
 *   fails with its error instead of being skipped.
 * - The learner database (.data/coding-school.db) is fingerprinted (existence,
 *   size, mtime, sha256) before stage 1 and after the final stage — even on
 *   failure. Any difference fails the whole run: verification must never
 *   touch learner data.
 * - One shared production server (next start) serves all browser stages; it
 *   is always stopped in the finally block.
 * - The server is started WITHOUT OPENROUTER_API_KEY so stage 12 exercises
 *   the deterministic fallback path.
 * - Noninteractive (CI=true) and idempotent: rerunning is safe; build output
 *   (.next) is gitignored and never committed.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const DB_PATH = join(ROOT, ".data", "coding-school.db");

/** Run a command with inherited stdio; resolve on exit 0, reject otherwise. */
function run(cmd, args, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, CI: "true", ...env },
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function dbFingerprint() {
  if (!existsSync(DB_PATH)) return { exists: false };
  const stat = statSync(DB_PATH);
  const hash = createHash("sha256").update(readFileSync(DB_PATH)).digest("hex");
  return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs, sha256: hash };
}

async function waitForServer(url, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`Production server never came up at ${url}`);
}

function portInUse() {
  return fetch(BASE_URL).then(r => r.ok).catch(() => false);
}

const results = [];
let server = null;

async function stage(name, fn) {
  const started = Date.now();
  console.log(`\n${"=".repeat(64)}\nSTAGE ${results.length + 1}/14: ${name}\n${"=".repeat(64)}`);
  try {
    await fn();
    results.push({ name, status: "PASS", ms: Date.now() - started });
    console.log(`\n>>> STAGE PASS: ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (error) {
    results.push({ name, status: "FAIL", ms: Date.now() - started, error: String(error.message ?? error).slice(0, 500) });
    console.log(`\n>>> STAGE FAIL: ${name} — ${String(error.message ?? error).slice(0, 500)}`);
    throw error;
  }
}

async function main() {
  console.log("Whole-product verification starting.");
  console.log(`Learner DB under test: ${DB_PATH}`);
  const dbBefore = dbFingerprint();
  console.log(`DB before: ${dbBefore.exists ? `exists, ${dbBefore.size} bytes, sha256 ${dbBefore.sha256.slice(0, 16)}…` : "absent (baseline: must stay absent)"}`);

  let failed = false;
  try {
    await stage("unit tests", () => run("npx", ["vitest", "run"]));
    await stage("curriculum validation", () => run("npx", ["vitest", "run", "tests/curriculum-validation.test.ts"]));
    await stage("grader mutation tests", () => run("npx", ["vitest", "run", "tests/grader-mutation.test.ts"]));
    await stage("sqlite repository/migration/security", () => run("npx", ["vitest", "run", "tests/sqlite.test.ts"]));
    await stage("typescript", () => run("npx", ["tsc", "--noEmit"]));
    await stage("eslint", () => run("npx", ["eslint"]));
    await stage("production build", () => run("npm", ["run", "build"]));

    // One shared production server for every browser stage. The tutor stage
    // requires the fallback path, so the provider key is stripped here.
    if (await portInUse()) {
      throw new Error(`port ${PORT} is already in use — free it before verifying so the run tests its own build`);
    }
    const serverEnv = { ...process.env };
    delete serverEnv.OPENROUTER_API_KEY;
    server = spawn("npx", ["next", "start", "--port", String(PORT)], { cwd: ROOT, stdio: "inherit", env: serverEnv });
    await waitForServer(BASE_URL);
    console.log(`Production server up at ${BASE_URL} (OPENROUTER_API_KEY unset)`);

    await stage("runtime-boundary trace", () => run("npx", ["vitest", "run", "tests/runtime-boundary.test.ts"]));
    await stage("diagnostic browser flow", () => run("node", ["scripts/verify-diagnostic.mjs"], { BASE_URL }));
    await stage("mission browser flow", () => run("node", ["scripts/verify-missions.mjs"], { BASE_URL }));
    await stage("portfolio export / ZIP inspection", () => run("npx", ["vitest", "run", "tests/zip-export.test.ts"]));
    await stage("tutor fallback + Learning Mode", () => run("node", ["scripts/verify-tutor.mjs"], { BASE_URL }));
    await stage("desktop 1280x720 journey", () => run("node", ["scripts/verify-desktop.mjs"], { BASE_URL }));
    await stage("mobile 375x812 journey", () => run("node", ["scripts/verify-mobile.mjs"], { BASE_URL }));
  } catch {
    failed = true;
  } finally {
    if (server) {
      console.log("\nStopping the production server…");
      server.kill("SIGTERM");
      await sleep(2000);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    const dbAfter = dbFingerprint();
    const dbChanged = JSON.stringify(dbBefore) !== JSON.stringify(dbAfter);
    console.log(`\nDB after:  ${dbAfter.exists ? `exists, ${dbAfter.size} bytes, sha256 ${dbAfter.sha256.slice(0, 16)}…` : "absent"}`);
    console.log(`DB integrity: ${dbChanged ? "FAIL — the learner database changed during verification" : "PASS — untouched"}`);
    if (dbChanged) failed = true;

    console.log(`\n${"=".repeat(64)}\nVERIFICATION SUMMARY\n${"=".repeat(64)}`);
    for (const r of results) {
      console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${(r.ms / 1000).toFixed(1).padStart(7)}s  ${r.name}${r.error ? ` — ${r.error}` : ""}`);
    }
    const ran = results.length;
    if (ran < 14) console.log(`SKIPPED  stages ${ran + 1}-14 (fail fast after the first failure)`);
    console.log(`\n${failed ? "RESULT: FAIL" : "RESULT: PASS — all 14 stages green, learner DB untouched"}`);
    process.exit(failed ? 1 : 0);
  }
}

main().catch(error => { console.error(`FATAL: ${error.message}`); process.exit(2); });
