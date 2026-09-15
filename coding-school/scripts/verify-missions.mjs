#!/usr/bin/env node
/**
 * End-to-end verification for the Task 2 ten-mission curriculum.
 *
 * Desktop 1280x720: full guided -> project -> explain smoke on csv-foundations
 *   through the real Python worker, starting from a blank profile.
 * Pandas offline: seeded prerequisite completions unlock pandas-missing-data;
 *   the guided pandas task runs with every external (non-localhost) request
 *   blocked, proving Pyodide loads pandas/NumPy from the vendored local wheels.
 * Mobile 375x812: dashboard and workbench render with no horizontal overflow.
 *
 * Fails on: any failed check, any console error or pageerror, any horizontal
 * overflow. Screenshots land in /tmp. Exits non-zero on the first failure.
 *
 * Usage:
 *   node scripts/verify-missions.mjs --serve   # starts `next dev` on :3101
 *   BASE_URL=http://localhost:3000 node scripts/verify-missions.mjs
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 3101;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const SHOULD_SERVE = process.argv.includes("--serve");

// Solutions pre-validated against the real graders (node + Pyodide, 2026-09-14).
const CONTACTS_SOLUTION = `def solve(rows):
    if type(rows) is not list:
        return []
    seen = set()
    out = []
    for row in rows:
        if type(row) is not dict:
            continue
        email = row.get("email")
        if type(email) is not str:
            continue
        email = email.strip().lower()
        if any(ch.isspace() for ch in email):
            continue
        local, sep, domain = email.partition("@")
        if not sep or not local or not domain or "@" in domain:
            continue
        if email in seen:
            continue
        seen.add(email)
        out.append(email)
    return out
`;

const PAYMENTS_SOLUTION = `import csv
import io
from decimal import Decimal, InvalidOperation

def solve(csv_text):
    if type(csv_text) is not str:
        return []
    reader = csv.DictReader(io.StringIO(csv_text))
    if list(reader.fieldnames or []) != ["id", "amount", "currency"]:
        return []
    seen = set()
    out = []
    for row in reader:
        if None in row:
            continue
        pid = row.get("id")
        amount_text = row.get("amount")
        currency = row.get("currency")
        if not all(type(v) is str for v in (pid, amount_text, currency)):
            continue
        pid = pid.strip()
        amount_text = amount_text.strip()
        currency = currency.strip().upper()
        if not pid or pid in seen:
            continue
        if currency not in ("USD", "EUR", "GBP"):
            continue
        try:
            amount = Decimal(amount_text)
        except InvalidOperation:
            continue
        if not amount.is_finite() or amount < 0:
            continue
        try:
            quantized = amount.quantize(Decimal("0.01"))
        except InvalidOperation:
            continue
        if amount != quantized:
            continue
        seen.add(pid)
        out.append({"id": pid, "amount": format(abs(quantized), ".2f"), "currency": currency})
    return out
`;

const PANDAS_SOLUTION = `import io
import pandas as pd

def solve(csv_text):
    if type(csv_text) is not str or not csv_text.strip():
        return []
    try:
        df = pd.read_csv(io.StringIO(csv_text), dtype=str, keep_default_na=False)
    except Exception:
        return []
    if list(df.columns) != ["id", "region", "amount", "qty"]:
        return []
    df = df[df["id"].fillna("").str.strip() != ""].copy()
    if df.empty:
        return []
    df["region"] = df["region"].fillna("").str.strip().replace("", "unknown")
    amounts = pd.to_numeric(df["amount"].fillna("").str.strip(), errors="coerce")
    median = amounts.median()
    fill = float(median) if pd.notna(median) else 0.0
    df["amount"] = amounts.fillna(fill).astype(float)
    df["qty"] = pd.to_numeric(df["qty"].fillna("").str.strip(), errors="coerce").fillna(0).astype(int)
    return [
        {"id": str(i).strip(), "region": str(r), "amount": float(a), "qty": int(q)}
        for i, r, a, q in zip(df["id"], df["region"], df["amount"], df["qty"])
    ]
`;

// Completed runs + passed attempts for the five missions that gate
// pandas-missing-data. Generated from the real curriculum and catalog by a
// throwaway vitest script (see git history); the payload is validated to
// survive migrateState with all five missions completed, so the integrity
// rule "missing attempts cannot unlock a later mission" is satisfied honestly.
// Regenerate if the curriculum, graders, or task ids change.
// The fixture timestamps are rewritten to "now" so no spaced-repetition
// review is due during the run; the pandas review stage then holds only the
// mission's authored review task.
const SEED_STATE = JSON.parse(
  readFileSync(new URL("./verify-missions-seed.json", import.meta.url), "utf8")
    .replaceAll("2026-09-13T12:00:00.000Z", new Date().toISOString()),
);
const SEED_SCRIPT = `(() => {
  window.localStorage.setItem("coding-school:learner-state", ${JSON.stringify(JSON.stringify(SEED_STATE))});
})();`;

let failures = 0;
function check(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`Server never came up at ${url}`);
}

/** Attach console-error and pageerror collectors; returns the error list. */
function watchErrors(page, errors) {
  page.on("pageerror", error => errors.push(`pageerror: ${String(error).split("\n")[0]}`));
  page.on("console", message => {
    if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 200)}`);
  });
}

async function acknowledgeInstruction(page) {
  const button = page.getByRole("button", { name: /I’ve read the examples/ });
  check("instruction task offers acknowledgement", await button.isVisible());
  await button.click();
}

async function fillCode(page, solution) {
  const toggle = page.getByRole("button", { name: /use plain text/i });
  if (await toggle.isVisible()) await toggle.click();
  await page.locator(".plain-editor").fill(solution);
}

/** Run checks and require every required check to pass. */
async function runChecksExpectPass(page, label) {
  await page.locator("#run-checks").click();
  await page.waitForSelector(".check-results", { timeout: 180000 });
  // The worker streams progress text; wait until the run settles (button re-enabled).
  await page.waitForFunction(() => !document.querySelector("#run-checks:disabled"), null, { timeout: 180000 }).catch(() => {});
  const failed = await page.locator(".check-results .check-fail").count();
  const passed = await page.locator(".check-results .check-pass").count();
  check(`${label}: all required checks pass`, failed === 0 && passed > 0, `${passed} passed, ${failed} failed`);
}

async function continueTo(page, namePattern) {
  const button = page.getByRole("button", { name: namePattern });
  check(`continue button (${namePattern}) appears`, await button.isVisible());
  await button.click();
}

async function noOverflow(page, label, width) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label}: no horizontal overflow`, scrollWidth <= width, `scrollWidth=${scrollWidth}`);
}

/** csv-foundations, blank profile, fully through the real UI and Python worker. */
async function desktopSmoke(browser) {
  console.log("\n--- desktop 1280x720: csv-foundations smoke ---");
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  watchErrors(page, errors);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  const startButton = page.getByRole("button", { name: /Start \d+-minute mission/ });
  check("dashboard offers the first mission", await startButton.isVisible());
  await startButton.click();
  await page.waitForFunction(() => document.querySelector(".plain-editor, #reflection, .stage-document, .reading-layout, .coding-layout"), null, { timeout: 15000 });

  // Review: nothing due yet -> Continue to Learn.
  await continueTo(page, /Continue to Learn/);
  // Learn: instruction then guided practice.
  await acknowledgeInstruction(page);
  await fillCode(page, CONTACTS_SOLUTION);
  await runChecksExpectPass(page, "guided contacts");
  await continueTo(page, /Continue to Build/);
  // Build: the payments project.
  await fillCode(page, PAYMENTS_SOLUTION);
  await runChecksExpectPass(page, "project payments");
  await continueTo(page, /Continue to Explain/);
  // Explain: reflection ends the mission.
  await page.locator("#reflection").fill("I split parsing from validation so quoted commas survive DictReader, then reject bad money with Decimal instead of floats. Remaining uncertainty: ragged rows with extra columns.");
  await page.getByRole("button", { name: /Save reflection & finish/ }).click();
  await page.waitForFunction(() => window.location.hash.startsWith("#summary?run="), null, { timeout: 15000 });
  check("mission completion summary shown", await page.getByText("MISSION COMPLETE").isVisible());

  // The finished mission shows as Completed in the lesson library.
  await page.getByRole("link", { name: "Lessons" }).click();
  const row = page.locator(".lesson-row", { hasText: "From small functions to a clean payments CSV" });
  check("library lists the finished mission", await row.isVisible());
  check("finished mission shows Completed", (await row.innerText()).includes("Completed"));
  await noOverflow(page, "desktop library", 1280);
  await page.screenshot({ path: "/tmp/missions-desktop.png" });
  check("zero console/page errors on desktop smoke", errors.length === 0, errors.join(" | ").slice(0, 300));
  await page.close();
}

/** pandas-missing-data guided task with every external request blocked. */
async function pandasOffline(browser) {
  console.log("\n--- desktop 1280x720: pandas offline ---");
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(SEED_SCRIPT);
  const blocked = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    blocked.push(`${route.request().method()} ${url.host}${url.pathname}`);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  watchErrors(page, errors);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  const startButton = page.getByRole("button", { name: /Start \d+-minute mission/ });
  check("dashboard offers pandas-missing-data after seeded prerequisites", await startButton.isVisible());
  const missionTitle = await page.locator(".mission-document #mission-title").innerText().catch(() => "");
  check("next mission is Missing Data, Found Data", missionTitle.includes("Missing Data"), missionTitle);
  await startButton.click();
  await page.waitForFunction(() => document.querySelector(".plain-editor, #reflection, .stage-document, .reading-layout, .coding-layout"), null, { timeout: 15000 });

  // Review + learn instruction click-throughs.
  await acknowledgeInstruction(page);
  await acknowledgeInstruction(page);
  // Guided practice: pandas must load from the vendored wheels with no CDN.
  await fillCode(page, PANDAS_SOLUTION);
  await runChecksExpectPass(page, "guided pandas clean (external requests blocked)");
  check("no external requests attempted during pandas run", blocked.length === 0, blocked.slice(0, 5).join(" | "));
  check("zero console/page errors on pandas offline run", errors.length === 0, errors.join(" | ").slice(0, 300));
  await page.screenshot({ path: "/tmp/missions-pandas.png" });
  await context.close();
}

/** Mobile layout: dashboard and an in-progress workbench coding view. */
async function mobileFlow(browser) {
  console.log("\n--- mobile 375x812 ---");
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const errors = [];
  watchErrors(page, errors);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await noOverflow(page, "mobile dashboard", 375);
  await page.getByRole("button", { name: /Start \d+-minute mission/ }).click();
  await page.waitForFunction(() => document.querySelector(".plain-editor, #reflection, .stage-document, .reading-layout, .coding-layout"), null, { timeout: 15000 });
  await noOverflow(page, "mobile review", 375);
  await page.getByRole("button", { name: /Continue to Learn/ }).click();
  await noOverflow(page, "mobile instruction", 375);
  await page.getByRole("button", { name: /I’ve read the examples/ }).click();
  await page.waitForSelector(".coding-layout", { timeout: 15000 });
  // Mobile shows the coding layout behind tabs; open the code panel first.
  await page.getByRole("button", { name: /Open code/ }).click();
  await page.waitForFunction(() => !document.getElementById("panel-code")?.hidden, null, { timeout: 15000 });
  await noOverflow(page, "mobile coding view", 375);
  await page.screenshot({ path: "/tmp/missions-mobile.png", fullPage: true });
  check("zero console/page errors on mobile", errors.length === 0, errors.join(" | ").slice(0, 300));
  await page.close();
}

async function main() {
  const { chromium } = await import("playwright");
  let server;
  if (SHOULD_SERVE) {
    server = spawn("npm", ["run", "dev", "--", "--port", String(PORT)], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" });
    await waitForServer(BASE_URL);
  }
  // --no-sandbox: this verification runs as root in CI-like environments.
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    await desktopSmoke(browser);
    await pandasOffline(browser);
    await mobileFlow(browser);
  } finally {
    await browser.close();
    server?.kill();
  }
  console.log(failures === 0 ? "\nAll mission checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => { console.error(`FATAL: ${error.message}`); process.exit(2); });
