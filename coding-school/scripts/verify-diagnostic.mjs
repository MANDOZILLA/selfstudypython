#!/usr/bin/env node
/**
 * End-to-end verification for the Task 1 diagnostic system.
 *
 * Covers the curriculum-ordered placement ladder, explicit gap and early-stop
 * flows, results, dashboard/course placement, and mobile layout.
 *
 * Usage:
 *   node scripts/verify-diagnostic.mjs --serve   # starts `next dev` on :3100
 *   BASE_URL=http://localhost:3000 node scripts/verify-diagnostic.mjs
 *
 * Screenshots land in /tmp. Exits non-zero on the first failed assertion.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 3100;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const SHOULD_SERVE = process.argv.includes("--serve");
const cwd = fileURLToPath(new URL("..", import.meta.url));
// Python code -> exact printed output for every code-reading placement item.
// tests/diagnostic-items.test.ts keeps this file in sync with the question bank.
const expectedByCode = JSON.parse(readFileSync(new URL("./diagnostic-answers.json", import.meta.url), "utf8"));

export function normalizeCode(value) {
  return value.replace(/\s+/g, " ").trim();
}

/** The rendered prompt shows the code without its ``` fence; find the item whose code it contains. */
export function expectedAnswer(promptText) {
  const page = normalizeCode(promptText);
  const matches = Object.entries(expectedByCode).filter(([code]) => page.includes(normalizeCode(code)));
  if (!matches.length) throw new Error(`No expected output found for prompt: ${page.slice(0, 120)}`);
  return matches.sort((a, b) => b[0].length - a[0].length)[0][1];
}

let failures = 0;
function check(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

/** Attach console-error and pageerror collectors; returns the error list.
 *  A verifier must FAIL on these, never just log them. */
function watchErrors(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(`pageerror: ${String(error).split("\n")[0]}`));
  page.on("console", message => {
    if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 200)}`);
  });
  return errors;
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

async function waitForDiagnosticState(sessionId, expectedResponses) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch(`${BASE_URL}/api/state`);
    if (response.ok) {
      const snapshot = await response.json();
      const session = snapshot.state?.diagnosticSessions?.find(item => item.id === sessionId);
      if (session && session.responses.length >= expectedResponses) return session;
    }
    await sleep(500);
  }
  throw new Error(`Diagnostic state did not sync ${expectedResponses} responses for ${sessionId}`);
}

async function main() {
  const { chromium } = await import("playwright");
  let server;
  if (SHOULD_SERVE) {
    execFileSync(process.execPath, ["scripts/prepare-editor.mjs"], { cwd });
    server = spawn(process.execPath, [createRequire(import.meta.url).resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(PORT)], { cwd, stdio: "ignore" });
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

/** Pass the first rung, declare a gap on the next, and inspect placement. */
async function desktopFlow(browser) {
  console.log("\n--- desktop 1280x720 ---");
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = watchErrors(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // The shared server may already host an in-progress session (retakes and
  // concurrent runs persist server-side), so accept resume as well as start.
  const startButton = page.getByRole("button", { name: /start placement scan|resume scan/i });
  // Dashboard boots from the server snapshot asynchronously; wait for the
  // entry to render instead of racing the first paint.
  await startButton.waitFor({ timeout: 15000 }).catch(() => {});
  check("dashboard shows the diagnostic entry", await startButton.isVisible());
  await startButton.click();
  await page.waitForURL(/diagnostic\?session=/);
  let sessionUrl = page.url();
  check("starting creates a session route", /diagnostic\?session=/.test(sessionUrl), sessionUrl);

  const sessionId = /diagnostic\?session=([^&]+)/.exec(page.url())?.[1];
  const responseCount = async () => (await waitForDiagnosticState(sessionId, 0)).responses.length;
  const initial = await page.locator(".diagnostic-prompt").innerText();
  check("placement starts with the beginner values rung", initial.includes("print('hello')") || initial.includes("x = 7"), initial.slice(0, 100));
  const answer = page.locator("#diagnostic-answer");
  await answer.fill(expectedAnswer(initial));
  await page.getByRole("button", { name: /submit/i }).click();
  await page.waitForFunction(previous => document.querySelector(".diagnostic-prompt")?.innerText !== previous, initial);
  const secondPrompt = await page.locator(".diagnostic-prompt").innerText();
  check("placement stays on the same rung for its second item", secondPrompt.includes("print('hello')") || secondPrompt.includes("x = 7"), secondPrompt.slice(0, 100));
  await page.locator("#diagnostic-answer").fill(expectedAnswer(secondPrompt));
  await page.getByRole("button", { name: /submit/i }).click();
  await page.waitForFunction(previous => document.querySelector(".diagnostic-prompt")?.innerText !== previous, secondPrompt);
  const nextPrompt = await page.locator(".diagnostic-prompt").innerText();
  check("a passed rung advances to conditionals", nextPrompt.includes("not (3 > 5)") || nextPrompt.includes("4 < 9") || nextPrompt.includes("score = 72"), nextPrompt.slice(0, 100));
  const beforeUnknown = await responseCount();
  await page.getByRole("button", { name: /I don.t know this/i }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Finish placement scan"]') !== null);
  check("one unknown declaration ends the scan", (await waitForDiagnosticState(sessionId, beforeUnknown + 1)).responses.length === beforeUnknown + 1);
  await page.getByRole("button", { name: /See my placement/i }).click();
  await page.getByRole("heading", { name: /Your course starts at: Booleans and if/i }).waitFor();
  check("results list known values concept", await page.getByText("Values, variables, and printing", { exact: true }).isVisible());
  check("results show the placement start", await page.getByRole("heading", { name: /Your course starts at: Booleans and if/i }).isVisible());
  await page.getByRole("button", { name: /Start learning/i }).click();
  check("dashboard recommends the matching mission", await page.getByRole("button", { name: /Start mission|Resume mission/ }).isVisible());
  await page.getByRole("link", { name: /MISSIONS/i }).click();
  check("earlier mission is marked placed out", (await page.locator(".lesson-row").filter({ hasText: "Your First Python Steps" }).innerText()).includes("PLACED OUT"));
  check("placed-out mission remains practiceable", await page.locator(".lesson-row").filter({ hasText: "Your First Python Steps" }).getByRole("button", { name: "Practice again" }).isVisible());

  // Early stop is available immediately and also ends at the current rung.
  // A completed placement exposes Retake directly on the dashboard.
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Retake$/ }).click();
  await page.waitForURL(url => /diagnostic\?session=/.test(url.href) && url.href !== sessionUrl);
  sessionUrl = page.url();
  await page.getByRole("button", { name: /Start teaching me here/i }).click();
  await page.getByRole("heading", { name: /Your course starts at:/i }).waitFor();

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
  check("zero console/page errors on desktop", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 300));
  await page.close();
}

async function mobileFlow(browser) {
  console.log("\n--- mobile 375x812 ---");
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const pageErrors = watchErrors(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Retake$/ }).click();
  await page.waitForURL(/diagnostic\?session=/);
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= 375);
  check("no horizontal overflow at 375px (question view)", noOverflow,
    `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
  await page.getByRole("button", { name: /Start teaching me here/i }).click();
  await page.getByRole("heading", { name: /Your course starts at:/i }).waitFor();
  const resultOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= 375);
  check("no horizontal overflow at 375px (placement results)", resultOverflow);
  await page.screenshot({ path: "/tmp/diagnostic-mobile.png", fullPage: true });
  check("zero console/page errors on mobile", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 300));
  await page.close();
}

main().catch(error => { console.error(`FATAL: ${error.message}`); process.exit(2); });
