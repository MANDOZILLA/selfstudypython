#!/usr/bin/env node
/**
 * Cross-product desktop journey at 1280x720: dashboard skill graph ->
 * mission workbench IDE (real Python run) -> Self-Assessment checkpoint ->
 * Portfolio. Complements the deep per-surface verifiers (diagnostic,
 * missions, tutor) with one connected pass over the whole product.
 *
 * Fails on: any failed check, any console error or pageerror, any
 * horizontal overflow. Screenshots land in /tmp.
 *
 * Usage:
 *   BASE_URL=http://localhost:3100 node scripts/verify-desktop.mjs
 */
import { setTimeout as sleep } from "node:timers/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3100";

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

let failures = 0;
function check(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

function watchErrors(page, errors) {
  page.on("pageerror", error => errors.push(`pageerror: ${String(error).split("\n")[0]}`));
  page.on("console", message => {
    if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 200)}`);
  });
}

async function noOverflow(page, label, width) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label}: no horizontal overflow`, scrollWidth <= width, `scrollWidth=${scrollWidth}`);
}

async function main() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    await journey(browser);
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? "\nAll desktop journey checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

async function journey(browser) {
  console.log("\n--- desktop 1280x720: full product journey ---");
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  watchErrors(page, errors);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // 1. Dashboard: skill graph and today's recommendation.
  check("skill graph visible on dashboard", await page.getByRole("heading", { name: /skill graph/i }).isVisible());
  const startButton = page.getByRole("button", { name: /Start \d+-minute mission|Resume/ });
  check("today's recommendation offers a mission", await startButton.first().isVisible());
  await noOverflow(page, "dashboard", 1280);

  // 2. Lessons library.
  await page.getByRole("link", { name: "Lessons" }).click();
  await page.waitForFunction(() => document.querySelector(".lesson-row"), null, { timeout: 15000 });
  check("lessons library lists missions", (await page.locator(".lesson-row").count()) >= 10);
  await noOverflow(page, "lessons library", 1280);

  // 3. Mission workbench: IDE + real Python run.
  await page.getByRole("link", { name: "Today" }).click();
  await page.getByRole("button", { name: /Start \d+-minute mission/ }).click();
  await page.waitForFunction(() => document.querySelector(".plain-editor, #reflection, .stage-document, .reading-layout, .coding-layout"), null, { timeout: 15000 });
  const continueLearn = page.getByRole("button", { name: /Continue to Learn/ });
  if (await continueLearn.isVisible().catch(() => false)) await continueLearn.click();
  const ack = page.getByRole("button", { name: /I’ve read the examples/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
  await page.waitForFunction(() => document.querySelector(".plain-editor, .coding-layout"), null, { timeout: 15000 });
  check("workbench coding layout renders", await page.locator(".coding-layout").isVisible().catch(() => false));
  const editorVisible = await page.locator(".plain-editor, .monaco-editor").first().isVisible().catch(() => false);
  check("IDE editor renders (Monaco or plain text)", editorVisible);
  await noOverflow(page, "workbench", 1280);

  // Real Python run through the worker: fill, run checks, expect pass.
  const toggle = page.getByRole("button", { name: /use plain text/i });
  if (await toggle.isVisible()) await toggle.click();
  await page.locator(".plain-editor").fill(CONTACTS_SOLUTION);
  await page.locator("#run-checks").click();
  await page.waitForSelector(".check-results", { timeout: 180000 });
  await page.waitForFunction(() => !document.querySelector("#run-checks:disabled"), null, { timeout: 180000 }).catch(() => {});
  const failed = await page.locator(".check-results .check-fail").count();
  const passed = await page.locator(".check-results .check-pass").count();
  check("guided task passes via the desktop IDE", failed === 0 && passed > 0, `${passed} passed, ${failed} failed`);

  // 4. Self-Assessment checkpoint.
  await page.getByRole("link", { name: "Self-Assessment" }).click();
  await page.waitForFunction(() => document.querySelector(".assessment-document, .checkpoint"), null, { timeout: 15000 }).catch(() => {});
  const checkpointVisible = await page.getByText(/checkpoint/i).first().isVisible().catch(() => false);
  check("assessment checkpoints listed", checkpointVisible);
  await noOverflow(page, "self-assessment", 1280);
  await page.screenshot({ path: "/tmp/journey-desktop-assessment.png" });

  // 5. Portfolio.
  await page.getByRole("link", { name: "Portfolio" }).click();
  await page.waitForFunction(() => document.querySelector(".portfolio-document, .project-card, .document"), null, { timeout: 15000 }).catch(() => {});
  check("portfolio view renders", await page.locator("#main-content").isVisible());
  await noOverflow(page, "portfolio", 1280);

  // 6. What I Learned log records the completed evidence.
  await page.getByRole("link", { name: "What I Learned" }).click();
  await sleep(500);
  check("learning log renders", await page.locator("#main-content").isVisible());
  await noOverflow(page, "what i learned", 1280);

  await page.screenshot({ path: "/tmp/journey-desktop.png" });
  check("zero console/page errors on desktop journey", errors.length === 0, errors.join(" | ").slice(0, 300));
  await page.close();
}

main().catch(error => { console.error(`FATAL: ${error.message}`); process.exit(2); });
