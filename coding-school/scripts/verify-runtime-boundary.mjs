import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

for (const script of ["dev", "start"]) {
  assert.match(packageJson.scripts[script], /--hostname\s+127\.0\.0\.1/, `${script} must bind Next to IPv4 loopback`);
}

const configuredDatabase = process.env.CODING_SCHOOL_DB_PATH;
const forbidden = [".data/", ".data\\"];
if (configuredDatabase) {
  forbidden.push(configuredDatabase.replaceAll("\\", "/"), configuredDatabase.replaceAll("/", "\\"));
}

const buildDirectory = resolve(root, process.env.CODING_SCHOOL_BUILD_DIR || ".next");
async function manifests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? manifests(join(directory, entry.name)) : entry.name.endsWith(".nft.json") ? [join(directory, entry.name)] : []));
  return nested.flat();
}

const traceFiles = await manifests(buildDirectory);
assert.ok(traceFiles.length > 0, "build must create at least one .nft.json trace manifest");
for (const traceFile of traceFiles) {
  const trace = await readFile(traceFile, "utf8");
  for (const value of forbidden) {
    assert.equal(trace.includes(value), false, `${basename(traceFile)} traces runtime SQLite data: ${value}`);
  }
}

console.log(`PASS: ${traceFiles.length} build trace manifests omit runtime SQLite data and Next scripts bind loopback.`);
