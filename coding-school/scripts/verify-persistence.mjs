import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run ONLY against a server launched with an isolated CODING_SCHOOL_DB_PATH.
const base = process.env.STUDIO_URL || "http://localhost:3401";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.on("pageerror", error => console.error(error.message));
page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
const read = () => page.evaluate(async () => (await fetch("/api/learner", { headers: { "X-Coding-School": "local" } })).json());
try {
  if (process.env.PERSISTENCE_SCENARIO === "import") {
    await page.addInitScript(() => localStorage.setItem("coding-school:learner-state", "{ corrupt original"));
    await page.goto(base);
    await page.getByRole("heading", { name: "Recover your saved work" }).waitFor();
    assert.equal((await read()).initialized, false);
    await page.getByRole("button", { name: "Back up data & reset" }).click();
    await page.getByRole("button", { name: "Start 45-minute mission" }).waitFor();
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("coding-school:recovery:"))), true);
    const legacy = (await read()).state;
    legacy.diagnostic = { completed: true, completedAt: "2026-09-11T12:00:00.000Z" };
    legacy.portfolio = [{ projectId: "csv-project", title: "My saved export", sourceFiles: { "main.py": "print('legacy source')" }, tests: [{ name: "exports", passed: true }], feedback: "My original feedback", score: 1, skillIds: ["csv-cleaning"], completedAt: "2026-09-11T12:00:00.000Z" }];
    // Use a separate context so the corrupt-state init script does not run again.
    const migratedContext = await browser.newContext();
    await migratedContext.addInitScript(value => { localStorage.setItem("coding-school:learner-state", JSON.stringify(value)); localStorage.setItem("coding-school:learning-mode", "off"); }, legacy);
    const importer = await migratedContext.newPage();
    await importer.goto(base);
    await importer.getByRole("heading", { name: "Bring your saved work into this studio" }).waitFor();
    assert.equal((await read()).initialized, false);
    await importer.getByRole("button", { name: "Import browser work", exact: true }).click();
    await importer.getByRole("button", { name: "Start 45-minute mission" }).waitFor();
    const imported = await read();
    assert.equal(imported.legacyImported, true);
    assert.equal(imported.learningMode, false);
    assert.deepEqual(imported.state.portfolio, legacy.portfolio);
    assert.equal(await importer.evaluate(() => localStorage.getItem("coding-school:sqlite-import-backup")), JSON.stringify(legacy));
    await importer.reload();
    await importer.getByRole("button", { name: "Start 45-minute mission" }).waitFor();
    assert.equal(await importer.getByRole("button", { name: "Import browser work", exact: true }).count(), 0);
    const health = await importer.evaluate(async () => (await fetch("/api/learner?health=1", { headers: { "X-Coding-School": "local" } })).json());
    assert.deepEqual(health, { ok: true, schemaVersion: 1, journalMode: "wal", foreignKeys: true });
    console.log("PASS: corrupt legacy recovery, explicit import, recoverable backup, import-once reload, preferences and DB integrity.");
    process.exitCode = 0;
  } else {
  await page.goto(base);
  await page.getByRole("button", { name: "Start 45-minute mission" }).waitFor();
  assert.equal((await read()).initialized, false, "Browser test requires a fresh isolated database");
  await page.getByRole("button", { name: "Start 45-minute mission" }).click();
  await page.getByRole("button", { name: "Continue to Learn" }).waitFor();
  assert.equal((await read()).initialized, true, "Starting a mission must commit to SQLite");
  await page.getByRole("button", { name: "Continue to Learn" }).click();
  await page.getByRole("button", { name: /I’ve read the examples/ }).click();
  await page.getByRole("heading", { name: "Guided practice: clean a contact list" }).waitFor();
  await page.getByRole("button", { name: "Use plain text", exact: true }).click();
  const source = "# persisted exact source\nprint('hello SQLite')";
  await page.getByRole("textbox", { name: "Python code", exact: true }).fill(source);
  await page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent === "Draft saved to SQLite");
  const first = await read();
  assert.equal(first.state.missionRuns[0].drafts["csv-guided"].sourceFiles["main.py"], source);
  assert.equal(first.state.attempts.length, 1);
  await page.reload();
  await page.getByRole("heading", { name: "Guided practice: clean a contact list" }).waitFor();
  if (await page.getByRole("button", { name: "Use plain text", exact: true }).isVisible()) await page.getByRole("button", { name: "Use plain text", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Python code", exact: true }).inputValue(), source);
  await page.route("**/api/learner", route => route.abort());
  await page.getByRole("textbox", { name: "Python code", exact: true }).fill("# unsaved local draft");
  await page.getByText("Not saved", { exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Python code", exact: true }).inputValue(), "# unsaved local draft");
  await page.unroute("**/api/learner");
  await page.getByRole("button", { name: "Retry saving" }).click();
  await page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent === "Draft saved to SQLite");
  assert.equal((await read()).state.missionRuns[0].drafts["csv-guided"].sourceFiles["main.py"], "# unsaved local draft");
  const stale = await context.newPage();
  await stale.goto(base);
  await stale.getByRole("button", { name: "Resume mission" }).waitFor();
  await page.getByRole("textbox", { name: "Python code", exact: true }).fill("# newest tab work");
  await page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent === "Draft saved to SQLite");
  const latestRevision = (await read()).revision;
  await stale.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Lessons", exact: true }).click();
  await stale.getByText(/Your saved work changed in another tab/).waitFor();
  assert.equal((await read()).revision, latestRevision);
  await stale.close();
  const contactSolution = `def solve(records):
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
  await page.getByRole("textbox", { name: "Python code", exact: true }).fill(contactSolution);
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page.getByText("Required checks passed. Your practice attempt is saved.", { exact: true }).waitFor({ timeout: 45000 });
  const checked = await read();
  assert.equal(checked.state.attempts.length, 2);
  assert.ok(checked.state.attempts.at(-1).checks.every(check => check.passed));
  await page.getByRole("button", { name: /Continue to Build/ }).click();
  await page.getByRole("heading", { name: "Repair a payments export", exact: true }).waitFor();
  await page.getByRole("button", { name: "Use plain text", exact: true }).click();
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
  await page.getByRole("textbox", { name: "Python code", exact: true }).fill(csvSolution);
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page.getByText("Required checks passed. Your project attempt is saved.", { exact: true }).waitFor({ timeout: 45000 });
  await page.getByRole("button", { name: /Continue to Explain/ }).click();
  await page.getByRole("textbox", { name: "Your explanation", exact: true }).fill("I validate records and money before accepting each distinct payment.");
  await page.getByRole("button", { name: /Save reflection & finish/ }).click();
  await page.getByRole("heading", { name: "Your project and reflection are saved." }).waitFor();
  assert.equal((await read()).state.missionRuns[0].status, "completed");
  await page.reload();
  await page.getByRole("heading", { name: "Your project and reflection are saved." }).waitFor();
  const offline = await context.newPage();
  await offline.route("**/api/learner", route => route.abort());
  await offline.goto(base);
  await offline.getByRole("heading", { name: "Your saved work is unavailable" }).waitFor();
  assert.equal(await offline.getByRole("button", { name: "Start 45-minute mission" }).count(), 0);
  assert.equal(await offline.getByText("No saved attempts yet.", { exact: true }).count(), 0);
  console.log("PASS: SQLite hydration, complete graded mission, exact source/checks/reflection reload, unavailable-server protection, retry and stale-tab conflict.");
  }
} finally { await browser.close(); }
