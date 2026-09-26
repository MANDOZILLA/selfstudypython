#!/usr/bin/env node
/**
 * Verification for the Task 6 tutor: deterministic fallback and Learning Mode.
 *
 * The server is expected to run WITHOUT OPENROUTER_API_KEY (the orchestrator
 * strips it), so the provider path is unreachable and the deterministic
 * built-in tutor must answer. Covers:
 *   - guided-practice code task shows the "Stuck?" tutor affordance
 *   - "Ask tutor" returns the built-in (deterministic) tutor, labeled as such
 *   - no request ever leaves the browser for openrouter.ai
 *   - the API key never appears in page source or responses
 *   - Learning Mode hides the tutor affordance and hints entirely
 *   - POST /api/tutor with independentMode:true is rejected with 403
 *   - POST /api/tutor with independentMode:false returns a tutor answer
 *   - zero console/page errors throughout
 *
 * Usage:
 *   BASE_URL=http://localhost:3100 node scripts/verify-tutor.mjs
 *
 * Exits non-zero on the first failed check.
 */
import { setTimeout as sleep } from "node:timers/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3100";

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

async function main() {
  const { chromium } = await import("playwright");
  // --no-sandbox: this verification runs as root in CI-like environments.
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    await tutorFlow(browser);
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? "\nAll tutor checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

async function tutorFlow(browser) {
  console.log("\n--- desktop 1280x720: tutor fallback + Learning Mode ---");
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  watchErrors(page, errors);

  const externalTutorRequests = [];
  page.on("request", request => {
    if (/openrouter\.ai/i.test(request.url())) externalTutorRequests.push(request.url());
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Reach a guided-practice code task: dashboard -> first mission -> Learn.
  const startButton = page.getByRole("button", { name: /Start \d+-minute mission/ });
  check("dashboard offers the first mission", await startButton.isVisible());
  await startButton.click();
  await page.waitForFunction(() => document.querySelector(".plain-editor, #reflection, .stage-document, .reading-layout, .coding-layout"), null, { timeout: 15000 });
  const continueLearn = page.getByRole("button", { name: /Continue to Learn/ });
  if (await continueLearn.isVisible().catch(() => false)) await continueLearn.click();
  const ack = page.getByRole("button", { name: /I’ve read the examples/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
  await page.waitForFunction(() => document.querySelector(".plain-editor, .coding-layout"), null, { timeout: 15000 });

  // Learning Mode defaults ON for a fresh profile (use-studio.ts): establish
  // an explicit baseline before any visibility assertion.
  await page.locator(".learning-toggle input").setChecked(false);
  await sleep(400);

  // Tutor affordance is visible outside Learning Mode.
  const tutorSection = page.locator('section[aria-label="Tutor"]');
  check("tutor affordance visible on a code task", await tutorSection.isVisible());
  const hintsVisible = await page.getByText("Need a nudge?").isVisible().catch(() => false);
  check("hints visible outside Learning Mode", hintsVisible);

  // Learning Mode FIRST: asking the tutor permanently records AI assistance,
  // and the app correctly keeps a task "recorded as assisted" once help was
  // used — so the independent-mode assertions must run before any help.
  await page.locator(".learning-toggle input").setChecked(true);
  await sleep(400);
  check("tutor affordance hidden in Learning Mode", !(await tutorSection.isVisible().catch(() => false)));
  check("hints hidden in Learning Mode", !(await page.getByText("Need a nudge?").isVisible().catch(() => false)));
  check(
    "independent-mode notice shown",
    await page.getByText(/Independent work/).first().isVisible().catch(() => false),
  );
  await page.screenshot({ path: "/tmp/tutor-learning-mode.png" });

  // Back to normal mode: the tutor affordance returns.
  await page.locator(".learning-toggle input").setChecked(false);
  await sleep(400);
  check("tutor affordance returns after leaving Learning Mode", await tutorSection.isVisible());

  // Ask the tutor with no provider key configured: deterministic fallback.
  await page.getByRole("button", { name: /Ask tutor/ }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="AI tutor suggestion"]') || document.querySelector(".tutor-section .error"),
    null, { timeout: 30000 },
  );
  const suggestion = page.locator('[aria-label="AI tutor suggestion"]');
  check("tutor returns an answer without a provider key", await suggestion.isVisible());
  const label = (await suggestion.innerText()).slice(0, 200);
  check("answer is labeled as the built-in tutor", /built-in tutor/i.test(label), label.slice(0, 80));
  check("no request reached openrouter.ai", externalTutorRequests.length === 0, externalTutorRequests.join(" | "));

  const pageSource = await page.content();
  check("API key never appears in page source", !/OPENROUTER_API_KEY/.test(pageSource));

  // Server-side enforcement: direct API calls.
  const forbidden = await page.request.post(`${BASE_URL}/api/tutor`, {
    data: { taskId: "x", taskTitle: "x", independentMode: true },
  });
  check("POST /api/tutor with independentMode:true is rejected", forbidden.status() === 403, `status=${forbidden.status()}`);

  const allowed = await page.request.post(`${BASE_URL}/api/tutor`, {
    data: { taskId: "probe", taskTitle: "probe", requirements: [], hints: [], code: "def solve(x):\n    return []\n", independentMode: false },
  });
  const allowedBody = await allowed.json().catch(() => ({}));
  check("POST /api/tutor answers without a provider key", allowed.status() === 200 && Boolean(allowedBody.tutor), `status=${allowed.status()}`);
  check(
    "API answer is the deterministic tutor",
    allowedBody.source === "deterministic",
    `source=${allowedBody.source}`,
  );
  check("API response carries no key material", !/sk-or-|Bearer/.test(JSON.stringify(allowedBody)));

  await page.screenshot({ path: "/tmp/tutor-desktop.png" });
  check("zero console/page errors on tutor flow", errors.length === 0, errors.join(" | ").slice(0, 300));
  await page.close();
}

main().catch(error => { console.error(`FATAL: ${error.message}`); process.exit(2); });
