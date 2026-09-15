#!/usr/bin/env node
/**
 * End-to-end verification for the Task 1 diagnostic system.
 *
 * Covers: dashboard entry -> adaptive flow -> concept grading -> coding runs
 * through the real Python worker -> in-progress restoration after reload ->
 * no infra failures on the happy path -> mobile 375x812 layout.
 *
 * Usage:
 *   node scripts/verify-diagnostic.mjs --serve   # starts `next dev` on :3100
 *   BASE_URL=http://localhost:3000 node scripts/verify-diagnostic.mjs
 *
 * Screenshots land in /tmp. Exits non-zero on the first failed assertion.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 3100;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const SHOULD_SERVE = process.argv.includes("--serve");

const SOLUTIONS = {
  "diag-fn-callforms": `import json\nfrom math import ceil\ndef solve(payload):\n    try:\n        values = json.loads(payload)\n    except (json.JSONDecodeError, TypeError):\n        return []\n    if type(values) is not list:\n        return []\n    return list(map(ceil, values))\n`,
  "diag-http-success": `def is_success(status):\n    return 200 <= status < 300\n`,
  "diag-file-with": `def read_lines(path):\n    with open(path) as f:\n        return f.read().splitlines()\n`,
};

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
    await desktopFlow(browser);
    await mobileFlow(browser);
  } finally {
    await browser.close();
    server?.kill();
  }
  console.log(failures === 0 ? "\nAll diagnostic checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Answer questions until two coding runs succeed or we run out of patience. */
async function desktopFlow(browser) {
  console.log("\n--- desktop 1280x720 ---");
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", error => console.log(`  [pageerror] ${String(error).split("\n")[0]}`));
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  const startButton = page.getByRole("button", { name: /take the placement diagnostic/i });
  check("dashboard shows the diagnostic entry", await startButton.isVisible());
  await startButton.click();
  await page.waitForURL(/diagnostic\?session=/);
  const sessionUrl = page.url();
  check("starting creates a session route", /diagnostic\?session=/.test(sessionUrl), sessionUrl);

  let codingSuccesses = 0;
  for (let step = 0; step < 16 && codingSuccesses < 2; step++) {
    const isCoding = await page.getByRole("button", { name: /run checks/i }).isVisible().catch(() => false);
    if (isCoding) {
      const prompt = await page.locator(".diagnostic-prompt").innerText();
      const itemId = Object.keys(SOLUTIONS).find(id => prompt.includes(id === "diag-fn-callforms" ? "solve(payload)" : id === "diag-http-success" ? "is_success" : "read_lines"));
      check("coding question is answerable", Boolean(itemId), prompt.slice(0, 60));
      if (!itemId) break;
      // Plain-text editor is the reliable automation path.
      const toggle = page.getByRole("button", { name: /use plain text/i });
      if (await toggle.isVisible()) await toggle.click();
      await page.locator(".plain-editor").fill(SOLUTIONS[itemId]);
      // Draft survives a reload before running (exact in-progress restoration).
      // The editor mode toggle is intentionally not persisted, so switch back
      // to plain text after the reload before reading the draft.
      await page.reload({ waitUntil: "networkidle" });
      const toggleAfter = page.getByRole("button", { name: /use plain text/i });
      if (await toggleAfter.isVisible()) await toggleAfter.click();
      const restored = await page.locator(".plain-editor").inputValue().catch(() => "");
      check("code draft restored after reload", restored.includes("def "), `item ${itemId}`);
      const metaBeforeRun = await page.locator(".diagnostic-meta").innerText();
      const answeredBefore = Number(/(\d+) of up to 25/.exec(metaBeforeRun)?.[1] ?? -1);
      const promptBefore = await page.locator(".diagnostic-prompt").textContent();
      await page.getByRole("button", { name: /run checks/i }).click();
      // A graded run records its response and advances the session in the same
      // React render that sets the result, so the checks panel only ever mounts
      // for infra/stale outcomes. Wait for the run to settle instead: either the
      // question advances (a response was recorded) or the infra/stale banner
      // appears (nothing recorded, item stays current).
      await page.waitForFunction((before) => {
        if (document.querySelector(".diagnostic-infra")) return true;
        if (document.querySelector('[aria-label="Finish diagnostic"]')) return true;
        const prompt = document.querySelector(".diagnostic-prompt");
        return !!prompt && prompt.textContent !== before;
      }, promptBefore, { timeout: 180000 });
      const infra = await page.locator(".diagnostic-infra").isVisible().catch(() => false);
      check("coding run completes without infra failure", !infra);
      const metaAfter = await page.locator(".diagnostic-meta").innerText();
      const answeredAfter = Number(/(\d+) of up to 25/.exec(metaAfter)?.[1] ?? -1);
      check("response recorded in progress", answeredAfter === answeredBefore + 1, `${answeredBefore} -> ${answeredAfter}`);
      const successes = Number(/(\d+) of \d+ successful Python runs/.exec(metaAfter)?.[1] ?? -1);
      check("successful runs counted", successes >= 0, metaAfter.replace(/\n/g, " "));
      codingSuccesses = Math.max(codingSuccesses, successes);
    } else {
      const answer = page.locator("#diagnostic-answer");
      if (!(await answer.isVisible().catch(() => false))) break;
      await answer.fill("I am not sure yet.");
      await page.getByRole("button", { name: /submit answer/i }).click();
      await page.waitForFunction(() => document.querySelector("#diagnostic-answer")?.value === "", { timeout: 5000 }).catch(() => {});
    }
  }
  check("two successful coding runs recorded", codingSuccesses >= 2, `${codingSuccesses} succeeded`);

  // Restoration: reload keeps the same session and progress.
  const before = await page.locator(".diagnostic-meta").innerText();
  await page.reload({ waitUntil: "networkidle" });
  check("reload keeps the session route", page.url() === sessionUrl);
  const after = await page.locator(".diagnostic-meta").innerText();
  check("reload restores exact progress", before === after, after.replace(/\n/g, " "));

  // Back-button restoration: leave for the dashboard, then go back — the same
  // session and progress must come back.
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.goBack({ waitUntil: "networkidle" });
  check("back button returns to the session route", page.url() === sessionUrl, page.url());
  const afterBack = await page.locator(".diagnostic-meta").innerText();
  check("back button restores exact progress", before === afterBack, afterBack.replace(/\n/g, " "));

  await page.screenshot({ path: "/tmp/diagnostic-desktop.png" });
  await page.close();
}

async function mobileFlow(browser) {
  console.log("\n--- mobile 375x812 ---");
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /take the placement diagnostic|resume diagnostic/i }).click();
  await page.waitForURL(/diagnostic\?session=/);
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= 375);
  check("no horizontal overflow at 375px (question view)", noOverflow,
    `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
  // Answer a few concepts to reach a coding question, then check the editor view.
  for (let i = 0; i < 10; i++) {
    if (await page.getByRole("button", { name: /run checks/i }).isVisible().catch(() => false)) break;
    const answer = page.locator("#diagnostic-answer");
    if (!(await answer.isVisible().catch(() => false))) break;
    await answer.fill("I am not sure yet.");
    await page.getByRole("button", { name: /submit answer/i }).click();
    await sleep(500);
  }
  const editorOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= 375);
  check("no horizontal overflow at 375px (coding view)", editorOverflow);
  await page.screenshot({ path: "/tmp/diagnostic-mobile.png", fullPage: true });
  await page.close();
}

main().catch(error => { console.error(`FATAL: ${error.message}`); process.exit(2); });
