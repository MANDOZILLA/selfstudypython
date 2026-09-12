import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.STUDIO_URL || "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
await mkdir("test-results", { recursive: true });
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
print('Console is separate from checks.')
`;
const csvSolution = `import csv
import io
from decimal import Decimal, InvalidOperation

def solve(csv_text):
    result, seen = [], set()
    reader = csv.DictReader(io.StringIO(csv_text))
    if reader.fieldnames != ['id', 'amount', 'currency']: return []
    for row in reader:
        if None in row or any(value is None for value in row.values()): continue
        identifier, currency = row['id'].strip(), row['currency'].strip().upper()
        try:
            amount = Decimal(row['amount'].strip())
            if not amount.is_finite() or amount < 0: continue
            cents = amount.quantize(Decimal('0.01'))
            if amount != cents: continue
        except InvalidOperation:
            continue
        if not identifier or currency not in {'USD', 'EUR', 'GBP'} or identifier in seen: continue
        seen.add(identifier)
        result.append({'id': identifier, 'amount': format(abs(cents), '.2f'), 'currency': currency})
    return result
`;

for (const [name, viewport] of [["desktop", { width: 1280, height: 720 }], ["mobile", { width: 375, height: 812 }]]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const mobile = name === "mobile";
  const snapshot = async label => page.screenshot({ path: `test-results/${label}-${name}.png`, fullPage: true });
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal overflow`);
  const nav = async label => {
    if (mobile) await page.getByRole("button", { name: "Navigate" }).click();
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: label, exact: true }).click();
  };
  const codePanel = async () => { if (mobile) await page.getByRole("tab", { name: "Code", exact: true }).click(); };
  const instructions = async () => { if (mobile) await page.getByRole("tab", { name: "Instructions", exact: true }).click(); };
  const plain = async () => {
    await codePanel();
    const toggle = page.getByRole("button", { name: "Use plain text", exact: true });
    if (await toggle.isVisible()) await toggle.click();
    return page.getByRole("textbox", { name: "Python code", exact: true });
  };
  const run = async expected => {
    await codePanel();
    await page.getByRole("button", { name: "Run checks", exact: true }).click();
    await page.locator(".run-status").filter({ hasText: expected }).waitFor({ timeout: 25000 });
    assert.match(await page.locator(".run-status").innerText(), new RegExp(expected));
  };
  const savedState = () => page.evaluate(() => JSON.parse(localStorage.getItem("coding-school:learner-state")));
  try {
    await page.goto(base);
    await page.getByRole("button", { name: "Start 45-minute mission" }).waitFor();
    assert.ok(await page.getByText("No reviews scheduled yet.").isVisible());
    await noOverflow(); await snapshot("today");
    await nav("Lessons");
    assert.equal(await page.getByText("Not started", { exact: true }).count(), 2);
    await snapshot("lessons");
    await nav("What I Learned");
    assert.ok(await page.getByRole("heading", { name: "No saved attempts yet." }).isVisible());
    await nav("Self-Assessment");
    assert.ok(await page.getByText(/does not generate an adaptive score/).isVisible());
    await snapshot("assessment");
    await nav("Today");
    await page.getByRole("button", { name: "Start 45-minute mission" }).click();
    assert.ok(await page.getByRole("heading", { name: "No retrieval is due for this mission." }).isVisible());
    await page.getByRole("button", { name: "Continue to Learn" }).click();
    assert.ok(await page.getByRole("heading", { name: "Validate before you transform" }).isVisible());
    assert.equal(await page.getByRole("button", { name: "Run checks", exact: true }).count(), 0);
    await page.getByRole("button", { name: /I’ve read the examples/ }).click();
    await page.getByRole("heading", { name: "Guided practice: clean a contact list" }).waitFor();
    await codePanel();
    if (mobile) {
      await page.getByRole("tab", { name: "Code", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("tab", { name: "Checks", exact: true }).getAttribute("aria-selected"), "true");
      await page.keyboard.press("ArrowLeft");
      assert.equal(await page.getByRole("tab", { name: "Code", exact: true }).getAttribute("aria-selected"), "true");
    }
    await page.locator(".monaco-editor").waitFor();
    if (!mobile) {
      const bounds = await page.getByRole("button", { name: "Run checks", exact: true }).boundingBox();
      assert.ok(bounds && bounds.y + bounds.height <= 720, "Run checks is below desktop viewport");
      await page.locator(".monaco-editor textarea").focus();
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.activeElement.id), "run-checks");
    }
    await noOverflow(); await snapshot("workbench");
    await run("Needs changes");
    assert.equal((await savedState()).attempts.at(-1).passed, false);
    assert.equal(await page.getByRole("button", { name: /Continue to Build/ }).count(), 0);
    await snapshot("failed-checks");
    await instructions();
    assert.equal(await page.getByRole("button", { name: "Reveal hint 1" }).count(), 0);
    await page.getByRole("checkbox", { name: "Learning Mode" }).uncheck();
    await page.getByRole("button", { name: "Reveal hint 1" }).click();
    assert.equal(await page.getByRole("checkbox", { name: "Learning Mode" }).isDisabled(), true);
    await (await plain()).fill(contactSolution);
    await nav("Today");
    await page.goBack();
    await page.getByRole("heading", { name: "Guided practice: clean a contact list" }).waitFor();
    assert.equal(await (await plain()).inputValue(), contactSolution);
    await nav("Today");
    await page.reload();
    await page.getByRole("button", { name: "Resume mission" }).click();
    assert.equal(await (await plain()).inputValue(), contactSolution);
    assert.equal((await savedState()).missionRuns[0].drafts["csv-guided"].assistance.hintsUsed, 1);
    await run("Passed");
    assert.equal((await savedState()).attempts.at(-1).assistance.hintsUsed, 1);
    await snapshot("passed-practice");
    await page.getByRole("button", { name: "Continue to Build", exact: false }).filter({ visible: true }).click();
    await page.getByRole("heading", { name: "Repair a payments export" }).waitFor();
    await page.getByRole("checkbox", { name: "Learning Mode" }).check();
    await run("Needs changes");
    await (await plain()).fill(csvSolution);
    await run("Passed");
    const state = await savedState();
    assert.equal(state.mastery["csv-cleaning"].status, "Demonstrated in project");
    await snapshot("passed-project");
    await page.getByRole("button", { name: "Continue to Explain", exact: false }).filter({ visible: true }).click();
    await page.getByRole("textbox", { name: "Your explanation" }).fill("I use DictReader because quoted IDs can include commas. I reject fractional cents and add each ID to seen only after full validation. I still need to practise malformed input boundaries.");
    await page.getByRole("button", { name: /Save reflection & finish/ }).click();
    await page.getByRole("heading", { name: "Your project and reflection are saved." }).waitFor();
    assert.ok(await page.getByText(/Project assistance: Independent/).isVisible());
    await snapshot("completion-summary");
    await page.reload();
    await page.getByRole("heading", { name: "Your project and reflection are saved." }).waitFor();
    await page.getByRole("button", { name: "Go to What I Learned" }).click();
    await page.getByRole("heading", { name: "Your work, with the receipts." }).waitFor();
    assert.equal((await savedState()).missionRuns[0].status, "completed");
    assert.equal(await page.locator(".evidence-entry").count(), 6);
    await page.locator(".evidence-entry").nth(1).locator("summary").click();
    assert.ok(await page.getByText(csvSolution, { exact: true }).isVisible());
    await snapshot("evidence");
    await nav("Self-Assessment");
    assert.ok(await page.getByRole("heading", { name: "Repair a payments export" }).isVisible());
    assert.ok(await page.getByRole("heading", { name: "Evidence-backed strengths" }).isVisible());
    assert.ok(await page.getByText(/I use DictReader because/).isVisible());
    await snapshot("project-assessment");
    await nav("Lessons");
    assert.equal(await page.getByText("Completed", { exact: true }).count(), 1);
    assert.ok(await page.getByRole("button", { name: "Open mission" }).isEnabled());
    await noOverflow();
    assert.deepEqual(errors, [], `${name}: browser console errors`);
    console.log(`PASS ${name}: destinations, honest fresh state, reading before coding, actual failed/passed Python checks, hint tracking, Back and reload persistence, project evidence, reflection, library completion, no console errors or horizontal overflow.`);
  } catch (error) {
    await snapshot("failure");
    console.error(await page.locator("body").innerText());
    throw error;
  } finally { await context.close(); }
}
await browser.close();
