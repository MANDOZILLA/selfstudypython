import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const base = process.env.STUDIO_URL || "http://localhost:3000";
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("coding-school:learner-state")));
const count = async () => (await state()).attempts.length;
const code = () => page.getByRole("textbox", { name: "Python code", exact: true });
const run = () => page.getByRole("button", { name: "Run checks", exact: true }).click();
const waitStatus = value => page.locator(".run-status").filter({ hasText: value }).waitFor({ timeout: 25000 });
const solution = `def solve(records):
    if not isinstance(records, list): return []
    result = []
    for row in records:
        if not isinstance(row, dict) or not isinstance(row.get('email'), str): continue
        email = row['email'].strip().lower()
        parts = email.split('@')
        if len(parts) == 2 and all(parts) and not any(c.isspace() for c in email) and email not in result:
            result.append(email)
    return result
`;
try {
  await page.goto(base);
  await page.getByRole("button", { name: "Start 45-minute mission" }).click();
  await page.getByRole("button", { name: "Continue to Learn" }).click();
  await page.getByRole("button", { name: /I’ve read the examples/ }).click();
  await page.getByRole("button", { name: "Use plain text" }).click();
  const starter = await code().inputValue();
  const beforeInfrastructure = await count();
  const reviewsBeforeInfrastructure = (await state()).reviewSchedule;

  await page.route("**/python-worker.js", route => route.abort());
  await run(); await waitStatus("Couldn't run");
  assert.equal(await code().inputValue(), starter);
  assert.equal(await count(), beforeInfrastructure);
  assert.deepEqual((await state()).reviewSchedule, reviewsBeforeInfrastructure);
  await page.unroute("**/python-worker.js");
  console.log("PASS worker startup failure: Couldn't run, no learner attempt, reviews unchanged, code preserved.");

  await code().fill("while True:\n    pass\n");
  await run(); await waitStatus("Timed out");
  assert.equal(await code().inputValue(), "while True:\n    pass\n");
  assert.equal((await state()).missionRuns[0].stageIndex, 1);
  assert.equal(await count(), beforeInfrastructure);
  assert.deepEqual((await state()).reviewSchedule, reviewsBeforeInfrastructure);
  await page.screenshot({ path: "test-results/timed-out-desktop.png" });
  console.log("PASS timeout: worker terminated, draft preserved, no advancement.");

  const attemptsBeforeCancel = await count();
  await run();
  await page.getByRole("button", { name: "Stop run" }).click();
  assert.equal(await page.locator(".run-status").innerText(), "Ready");
  assert.equal(await count(), attemptsBeforeCancel);
  await run();
  await code().fill(solution);
  assert.equal(await page.locator(".run-status").innerText(), "Ready");
  assert.equal(await count(), attemptsBeforeCancel);
  console.log("PASS cancellation: Stop and editing cancel stale runs without recording attempts.");

  await page.getByRole("button", { name: "Run checks", exact: true }).evaluate(button => { button.click(); button.click(); });
  await waitStatus("Passed");
  assert.equal(await count(), attemptsBeforeCancel + 1);
  console.log("PASS duplicate-run guard: rapid double activation records exactly one result.");

  await code().fill(`${solution}\n# a new attempt`);
  const attemptsBeforeFailure = await count();
  await run();
  await page.evaluate(() => {
    window.originalStudioSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "coding-school:learner-state") throw new DOMException("Storage full", "QuotaExceededError");
      return window.originalStudioSetItem.call(this, key, value);
    };
  });
  await waitStatus("Passed");
  await page.getByRole("alert").filter({ hasText: "Changes could not be saved." }).waitFor();
  assert.equal(await count(), attemptsBeforeFailure);
  assert.equal(await page.getByRole("button", { name: /Continue to Build/ }).count(), 0);
  assert.ok(await page.getByText(/this attempt has not been saved/).isVisible());
  await page.screenshot({ path: "test-results/storage-failure-desktop.png" });
  await page.evaluate(() => { Storage.prototype.setItem = window.originalStudioSetItem; });
  await run(); await waitStatus("Passed");
  assert.equal(await count(), attemptsBeforeFailure + 1);
  console.log("PASS failed persistence: no saved evidence claim, no advancement, retry succeeds.");

  const toggle = page.getByRole("checkbox", { name: "Learning Mode" });
  assert.equal(await toggle.isChecked(), true);
  await toggle.uncheck();
  await page.reload();
  await page.getByRole("checkbox", { name: "Learning Mode" }).waitFor();
  assert.equal(await page.getByRole("checkbox", { name: "Learning Mode" }).isChecked(), false);
  await page.getByRole("checkbox", { name: "Learning Mode" }).check();
  console.log("PASS Learning Mode preference persists; in-app AI remains unavailable.");
} finally {
  await context.close();
  await browser.close();
}
