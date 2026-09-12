import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.STUDIO_URL || "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const contactSolution = `def solve(records):
    if type(records) is not list: return []
    result, seen = [], set()
    for row in records:
        if type(row) is not dict or type(row.get('email')) is not str: continue
        email = row['email'].strip().lower()
        parts = email.split('@')
        if len(parts) != 2 or not all(parts) or any(c.isspace() for c in email) or email in seen: continue
        seen.add(email)
        result.append(email)
    return result
`;
const csvSolution = `import csv
import io
from decimal import Decimal, InvalidOperation
def solve(csv_text):
    reader = csv.DictReader(io.StringIO(csv_text))
    if reader.fieldnames != ['id', 'amount', 'currency']: return []
    result, seen = [], set()
    for row in reader:
        if None in row or any(value is None for value in row.values()): continue
        identifier, currency = row['id'].strip(), row['currency'].strip().upper()
        try:
            amount = Decimal(row['amount'].strip())
            if not amount.is_finite() or amount < 0: continue
            cents = amount.quantize(Decimal('0.01'))
            if amount != cents: continue
        except InvalidOperation: continue
        if not identifier or currency not in {'USD','EUR','GBP'} or identifier in seen: continue
        seen.add(identifier)
        result.append({'id':identifier,'amount':format(abs(cents),'.2f'),'currency':currency})
    return result
`;
const inventorySolution = `def solve(records):
    if type(records) is not list: return []
    result, seen = [], set()
    for row in records:
        if type(row) is not dict or type(row.get('sku')) is not str or type(row.get('quantity')) is not int: continue
        sku, quantity = row['sku'].strip(), row['quantity']
        if not sku or quantity < 0 or sku in seen: continue
        seen.add(sku)
        result.append({'sku':sku,'quantity':quantity})
    return result
`;
const jsonSolution = `import json
from decimal import Decimal, InvalidOperation
def solve(json_text):
    try: payload = json.loads(json_text)
    except (json.JSONDecodeError, TypeError): return []
    if type(payload) is not dict or type(payload.get('payments')) is not list: return []
    result, seen = [], set()
    for row in payload['payments']:
        if type(row) is not dict or type(row.get('id')) is not str or type(row.get('money')) is not dict: continue
        money = row['money']
        if type(money.get('amount')) is not str or type(money.get('currency')) is not str: continue
        identifier, currency = row['id'].strip(), money['currency'].strip().upper()
        try:
            amount = Decimal(money['amount'].strip())
            if not amount.is_finite() or amount < 0: continue
            cents = amount.quantize(Decimal('0.01'))
            if amount != cents: continue
        except InvalidOperation: continue
        if not identifier or currency not in {'USD','EUR','GBP'} or identifier in seen: continue
        seen.add(identifier)
        result.append({'id':identifier,'amount':format(abs(cents),'.2f'),'currency':currency})
    return result
`;

async function nav(page, label, mobile = false) {
  if (mobile) await page.getByRole("button", { name: "Navigate" }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: label, exact: true }).click();
}
async function passCode(page, source) {
  const toggle = page.getByRole("button", { name: "Use plain text", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("textbox", { name: "Python code", exact: true }).fill(source);
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page.locator(".run-status").filter({ hasText: "Passed" }).waitFor({ timeout: 25000 });
}
async function completeMission(page, guided, project) {
  await page.getByRole("button", { name: "Start 45-minute mission" }).click();
  await page.getByRole("button", { name: "Continue to Learn" }).click();
  await page.getByRole("button", { name: /I’ve read the examples/ }).click();
  await passCode(page, guided);
  await page.getByRole("button", { name: /Continue to Build/ }).click();
  await passCode(page, project);
  await page.getByRole("button", { name: /Continue to Explain/ }).click();
  await page.getByRole("textbox", { name: "Your explanation" }).fill("I validated each boundary before transformation, preserved first valid order, and recorded one remaining boundary case to practise later.");
  await page.getByRole("button", { name: /Save reflection & finish/ }).click();
  await page.getByRole("button", { name: "Back to Today" }).click();
}
async function verifyReview(storageState, name, viewport) {
  const mobile = name === "mobile";
  const context = await browser.newContext({ viewport, storageState });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  try {
    await page.goto(base);
    await page.getByRole("heading", { name: "Bring a familiar pattern back to mind" }).waitFor();
    assert.equal(await page.getByText("YOU’LL BUILD", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Start 45-minute mission" }).count(), 0);
    assert.ok(await page.getByRole("button", { name: "Start review" }).isVisible());
    assert.equal(await page.locator(".stage-rail").getAttribute("aria-label"), "Review stage");
    assert.equal(await page.locator(".stage-rail li").count(), 1);
    await nav(page, "Lessons", mobile);
    assert.equal(await page.getByText("Completed", { exact: true }).count(), 2);
    await nav(page, "Today", mobile);
    await page.getByRole("button", { name: "Start review" }).click();
    await page.getByRole("heading", { name: "Scheduled skill review" }).waitFor();
    assert.equal(await page.locator(".workbench-heading .stage-rail li").count(), 1);
    assert.equal(await page.getByText("YOU’LL BUILD", { exact: true }).count(), 0);
    while (true) {
      if (mobile) await page.getByRole("tab", { name: "Code", exact: true }).click();
      await page.getByRole("button", { name: "Run checks", exact: true }).click();
      await page.locator(".run-status").filter({ hasText: "Needs changes" }).waitFor({ timeout: 25000 });
      const finish = page.getByRole("button", { name: "Finish review", exact: false });
      if (await finish.count()) { await finish.filter({ visible: true }).click(); break; }
      await page.getByRole("button", { name: "Continue to next task", exact: false }).filter({ visible: true }).click();
    }
    await page.getByRole("heading", { name: "Your review is saved." }).waitFor();
    assert.ok(await page.getByText("Your completed project history is unchanged.").isVisible());
    await nav(page, "Lessons", mobile);
    assert.equal(await page.getByText("Completed", { exact: true }).count(), 2);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), `${name}: horizontal overflow`);
    assert.deepEqual(errors, []);
    console.log(`PASS ${name} review-only: review card and one-stage rail make no build promise; failed retrievals finish review without downgrading the completed library.`);
  } finally { await context.close(); }
}

const setup = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await setup.newPage();
try {
  await page.goto(base);
  await page.getByRole("button", { name: "Start 45-minute mission" }).waitFor();
  await completeMission(page, contactSolution, csvSolution);
  await completeMission(page, inventorySolution, jsonSolution);
  await page.evaluate(() => {
    const key = "coding-school:learner-state";
    const state = JSON.parse(localStorage.getItem(key));
    state.attempts.forEach((attempt, index) => { attempt.completedAt = new Date(Date.UTC(2026, 7, 1, 12, index)).toISOString(); });
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await page.getByRole("heading", { name: "Bring a familiar pattern back to mind" }).waitFor();
  const storageState = await setup.storageState();
  await verifyReview(storageState, "desktop", { width: 1280, height: 720 });
  await verifyReview(storageState, "mobile", { width: 375, height: 812 });
} finally {
  await setup.close();
  await browser.close();
}
