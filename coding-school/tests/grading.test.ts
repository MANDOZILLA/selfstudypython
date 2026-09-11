import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { loadPyodide } from "pyodide";
import { curriculum } from "../lib/curriculum";

export const reference = `import csv
import io
from decimal import Decimal, InvalidOperation

def solve(csv_text: str):
    result = []
    seen = set()
    reader = csv.DictReader(io.StringIO(csv_text))
    if reader.fieldnames != ['id', 'amount', 'currency']:
        return []
    for row in reader:
        if None in row or any(value is None for value in row.values()):
            continue
        identifier = row['id'].strip()
        currency = row['currency'].strip().upper()
        try:
            amount = Decimal(row['amount'].strip())
            if not amount.is_finite() or amount < 0:
                continue
            rounded = amount.quantize(Decimal('0.01'))
            if amount != rounded:
                continue
        except InvalidOperation:
            continue
        if not identifier or currency not in {'USD', 'EUR', 'GBP'} or identifier in seen:
            continue
        seen.add(identifier)
        result.append({'id': identifier, 'amount': format(abs(rounded), '.2f'), 'currency': currency})
    return result
`;

type Result = { passed: boolean; executionOk: boolean; score: number; tests: { name: string; passed: boolean }[]; requestId: string; graderVersion: string };
let runtime: Awaited<ReturnType<typeof loadPyodide>>;
beforeAll(async () => { runtime = await loadPyodide({ indexURL: resolve("public/pyodide") }); }, 60000);

async function run(code: string, graderId = "payments-csv-v1", exerciseId = "messy-csv-challenge"): Promise<Result> {
  const workerSource = readFileSync(resolve("public/python-worker.js"), "utf8");
  // Use the real runtime; only the browser message transport is substituted.
  const imports: Record<string, unknown> = { loadPyodide: async () => runtime };
  for (const match of workerSource.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](\.\/[^"']+)["'];/g)) {
    Object.assign(imports, await import(/* @vite-ignore */ resolve("public", match[2])));
  }
  let reply: Result | undefined;
  const self = { postMessage: (value: Result) => { reply = value; }, onmessage: undefined as unknown as (event: { data: unknown }) => Promise<void> };
  runInNewContext(workerSource.replace(/^import .*;$/gm, ""), { ...imports, self });
  await self.onmessage({ data: { type: "run", requestId: "test-request", exerciseId, graderId, files: { "main.py": code }, code } });
  expect(reply).toBeDefined();
  return reply!;
}

describe("exercise-specific Python grading", () => {
  it.each([
    ["starter", curriculum.lessons[0].exercise.starterFiles["main.py"]],
    ["arbitrary code", "value = 3"],
    ["print-only code", "print('all tests pass')"],
    ["constant answer", "def solve(value):\n    return [42]"],
    ["empty answer", "def solve(value):\n    return []"],
  ])("rejects %s without awarding evidence", async (_label, code) => {
    const result = await run(code);
    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(1);
  });
  it("passes the reference solution with named required checks", async () => {
    const result = await run(reference);
    expect(result.passed).toBe(true);
    expect(result.executionOk).toBe(true);
    expect(result.score).toBe(1);
    expect(result.requestId).toBe("test-request");
    expect(result.graderVersion).toBeTruthy();
    expect(result.tests.length).toBeGreaterThanOrEqual(8);
    expect(result.tests.every(test => test.passed)).toBe(true);
  });
  it.each([
    ["duplicates", reference.replace(" or identifier in seen", "")],
    ["fractional cents", reference.replace("if amount != rounded:", "if False:")],
    ["negative amounts", reference.replace(" or amount < 0", "")],
    ["currency normalization", reference.replace(".strip().upper()", ".strip()")],
    ["row order", reference.replace("return result", "return list(reversed(result))")],
    ["extra fields", reference.replace("if None in row or any", "if False or any")],
    ["wrong shape", reference.replace("'amount': format(abs(rounded), '.2f')", "'amount': float(rounded)")],
  ])("rejects partial behavior: %s", async (_label, code) => {
    expect((await run(code)).passed).toBe(false);
  });
  it("does not accept concept names in comments or strings", async () => {
    const result = await run("# csv.DictReader Decimal\ntext = 'csv.DictReader Decimal'\ndef solve(value):\n    return []");
    expect(result.tests.filter(test => /concept/i.test(test.name)).every(test => !test.passed)).toBe(true);
    expect(result.tests.filter(test => /concept/i.test(test.name))).toHaveLength(2);
  });
  it("rejects float-only money parsing with a dead unrelated Decimal call", async () => {
    const floatOnly = reference
      .replace("import csv", "import math\nimport csv\n\ndef unrelated():\n    return Decimal('1')\n")
      .replace("Decimal(row['amount'].strip())", "float(row['amount'].strip())")
      .replace("amount.is_finite()", "math.isfinite(amount)")
      .replace("amount.quantize(Decimal('0.01'))", "round(amount, 2)")
      .replace("except InvalidOperation:", "except ValueError:");
    const result = await run(floatOnly);
    expect(result.tests.find(test => /Concept:.*Decimal/.test(test.name))?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
  it("rejects Decimal constructed from a float string that loses exact cents", async () => {
    const result = await run(reference.replace("Decimal(row['amount'].strip())", "Decimal(str(float(row['amount'].strip())))").replace("except InvalidOperation:", "except (InvalidOperation, ValueError):"));
    expect(result.tests.find(test => /Exact cents/.test(test.name))?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
  it("rejects case-insensitive duplicate detection for case-sensitive payment IDs", async () => {
    const result = await run(reference.replace("identifier in seen", "identifier.lower() in seen").replace("seen.add(identifier)", "seen.add(identifier.lower())"));
    expect(result.tests.find(test => /first valid occurrence/.test(test.name))?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
  it("rejects accepting reordered headers with the same column names", async () => {
    const result = await run(reference.replace("reader.fieldnames != ['id', 'amount', 'currency']", "set(reader.fieldnames or []) != {'id', 'amount', 'currency'}"));
    expect(result.tests.find(test => /headers/.test(test.name))?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
  it("accepts Decimal parsing in an executed helper with import aliases", async () => {
    const helper = reference
      .replace("import csv", "import csv as delimited")
      .replace("csv.DictReader", "delimited.DictReader")
      .replace("from decimal import Decimal, InvalidOperation", "from decimal import Decimal as Money, InvalidOperation")
      .replaceAll("Decimal(", "Money(")
      .replace("def solve(csv_text: str):", "def parse_amount(text):\n    return Money(text)\n\ndef solve(csv_text: str):")
      .replace("Money(row['amount'].strip())", "parse_amount(row['amount'].strip())");
    expect((await run(helper)).passed).toBe(true);
  });
  it.each(["1", "12.00", "90071992547409.91"])("rejects an exact Fraction parser with unrelated Decimal marker %s", async marker => {
    const fractionParser = reference
      .replace("import csv", "from fractions import Fraction\nimport csv")
      .replace("        try:", `        marker_text = '${marker}'\n        marker = Decimal(marker_text)\n        if marker < 0:\n            continue\n        try:`)
      .replace("Decimal(row['amount'].strip())", "Fraction(row['amount'].strip())")
      .replace("not amount.is_finite() or ", "")
      .replace("amount.quantize(Decimal('0.01'))", "Fraction(round(amount * 100), 100)")
      .replace("except InvalidOperation:", "except (InvalidOperation, ValueError, ZeroDivisionError):");
    const result = await run(fractionParser);
    expect(result.tests.filter(test => !/Concept:/.test(test.name)).every(test => test.passed)).toBe(true);
    expect(result.tests.find(test => /Concept:.*Decimal/.test(test.name))?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
  it.each([
    "    text = '1'\n    unused = Decimal(text)\n",
    "    if False:\n        text = '1'\n        print(Decimal(text))\n",
    "    text = '1'\n    Decimal(text)\n",
  ])("does not credit an unused or unexecuted Decimal conversion %#", async unrelated => {
    const floatOnly = reference
      .replace("import csv", "import math\nimport csv")
      .replace("    result = []", unrelated + "    result = []")
      .replace("Decimal(row['amount'].strip())", "float(row['amount'].strip())")
      .replace("amount.is_finite()", "math.isfinite(amount)")
      .replace("amount.quantize(Decimal('0.01'))", "round(amount, 2)")
      .replace("except InvalidOperation:", "except ValueError:");
    const result = await run(floatOnly);
    expect(result.tests.find(test => /Concept:.*Decimal/.test(test.name))?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
  it("reports exceptions as failed execution", async () => {
    const result = await run("raise ValueError('broken')");
    expect(result.executionOk).toBe(false);
    expect(result.passed).toBe(false);
  });
  it.each(["", "unknown-grader", "functions-scope-v1"])("fails closed for grader %s", async graderId => {
    const result = await run(reference, graderId);
    expect(result.passed).toBe(false);
    expect(result.executionOk).toBe(false);
  });
  it("does not apply payments checks to another exercise", async () => {
    expect((await run(reference, "payments-csv-v1", "functions-scope-challenge")).passed).toBe(false);
  });
});
