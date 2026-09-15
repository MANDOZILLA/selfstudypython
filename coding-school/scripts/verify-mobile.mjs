#!/usr/bin/env node
/**
 * Cross-product mobile journey at 375x812: dashboard -> mission workbench
 * (mobile tab panels) -> Self-Assessment -> Portfolio, asserting no
 * horizontal overflow at every step and zero console/page errors.
 *
 * Usage:
 *   BASE_URL=http://localhost:3100 node scripts/verify-mobile.mjs
 */
import { setTimeout as sleep } from "node:timers/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3100";
const WIDTH = 375;

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

async function noOverflow(page, label) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label}: no horizontal overflow at ${WIDTH}px`, scrollWidth <= WIDTH, `scrollWidth=${scrollWidth}`);
}

/** Below ~1024px the nav links hide behind the "Navigate" menu button. */
async function goNav(page, name) {
  const link = page.getByRole("link", { name, exact: true });
  if (!(await link.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /Navigate|Close menu/ }).click();
  }
  await link.click();
}

/**
 * Blank the durable SQLite store so the mobile journey starts from a fresh
 * profile — the pre-SQLite condition it was written for, when every fresh
 * browser context booted with empty localStorage. Without this, the journey
 * inherits the desktop journey's mission progress from earlier in the
 * pipeline, and the dashboard offers "Resume" instead of "Start N-minute
 * mission", which the workbench step below requires.
 */
async function resetServerState() {
  const snapshot = await (await fetch(`${BASE_URL}/api/state`)).json();
  if (typeof snapshot?.revision !== "number") {
    throw new Error(`resetServerState: unexpected GET /api/state body: ${JSON.stringify(snapshot).slice(0, 200)}`);
  }
  const res = await fetch(`${BASE_URL}/api/state`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: snapshot.revision, state: {} }),
  });
  if (res.status !== 200) {
    const body = await res.text().catch(() => "");
    throw new Error(`resetServerState: PUT /api/state returned ${res.status}: ${body.slice(0, 300)}`);
  }
  console.log(`resetServerState: blanked durable server state (was revision ${snapshot.revision})`);
}

async function main() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    await journey(browser);
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? "\nAll mobile journey checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

async function journey(browser) {
  console.log("\n--- mobile 375x812: full product journey ---");
  await resetServerState();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 812 }, isMobile: true, hasTouch: true });
  const errors = [];
  watchErrors(page, errors);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector('[aria-label="Recommended next step"]', { timeout: 20000 });

  check("today's recommendation offers a mission on mobile",
    await page.getByRole("button", { name: /Start \d+-minute mission|Resume/ }).first().isVisible());
  await noOverflow(page, "mobile dashboard");

  await goNav(page, "What I Learned");
  check("skill graph visible on mobile", await page.getByRole("heading", { name: /skill graph/i }).isVisible());
  await noOverflow(page, "mobile skill graph");

  await goNav(page, "Lessons");
  await page.waitForFunction(() => document.querySelector(".lesson-row"), null, { timeout: 15000 });
  check("mobile lessons library lists missions", (await page.locator(".lesson-row").count()) >= 10);
  await noOverflow(page, "mobile lessons");

  // Mission workbench on mobile: tab panels (instructions / code / checks).
  await goNav(page, "Today");
  await page.getByRole("button", { name: /Start \d+-minute mission/ }).click();
  await page.waitForFunction(() => document.querySelector(".plain-editor, #reflection, .stage-document, .reading-layout, .coding-layout"), null, { timeout: 15000 });
  const continueLearn = page.getByRole("button", { name: /Continue to Learn/ });
  if (await continueLearn.isVisible().catch(() => false)) await continueLearn.click();
  const ack = page.getByRole("button", { name: /I’ve read the examples/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
  await page.waitForFunction(() => document.querySelector(".coding-layout"), null, { timeout: 15000 });
  await noOverflow(page, "mobile workbench instructions");

  // Mobile tab navigation: open the code panel, then the checks panel.
  const openCode = page.getByRole("button", { name: /Open code/ });
  if (await openCode.isVisible().catch(() => false)) await openCode.click();
  await page.waitForFunction(() => document.querySelector(".plain-editor, .monaco-editor"), null, { timeout: 15000 }).catch(() => {});
  const editorVisible = await page.locator(".plain-editor, .monaco-editor").first().isVisible().catch(() => false);
  check("mobile IDE editor renders", editorVisible);
  await page.screenshot({ path: "/tmp/journey-mobile-code.png" });
  await noOverflow(page, "mobile workbench code");

  await goNav(page, "Self-Assessment");
  await sleep(600);
  check("mobile assessment view renders", await page.locator("#main-content").isVisible());
  await noOverflow(page, "mobile self-assessment");

  await goNav(page, "Portfolio");
  await sleep(600);
  check("mobile portfolio view renders", await page.locator("#main-content").isVisible());
  await noOverflow(page, "mobile portfolio");

  await page.screenshot({ path: "/tmp/journey-mobile.png", fullPage: true });
  check("zero console/page errors on mobile journey", errors.length === 0, errors.join(" | ").slice(0, 300));
  await page.close();
}

main().catch(error => { console.error(`FATAL: ${error.message}`); process.exit(2); });
