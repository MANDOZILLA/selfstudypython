import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = join(root, "scripts", "fixtures", "runtime-boundary-relative-db");
const configuredDatabase = join(fixture, "runtime", "learner.db");

await assert.rejects(
  run(process.execPath, [join(root, "scripts", "verify-runtime-boundary.mjs")], {
    cwd: fixture,
    env: { ...process.env, CODING_SCHOOL_BUILD_DIR: "build", CODING_SCHOOL_DB_PATH: configuredDatabase },
  }),
  error => error.code === 1 && error.stderr.includes("traces runtime SQLite data"),
);

console.log("PASS: verifier rejects relative configured SQLite DB entries and their WAL/SHM sidecars.");
