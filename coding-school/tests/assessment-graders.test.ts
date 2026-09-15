import { beforeAll, describe, expect, test } from "vitest";
import { loadPyodide } from "pyodide";
import { resolve } from "node:path";
import { runSubmission } from "../public/grading/runner.js";

let runtime: Awaited<ReturnType<typeof loadPyodide>>;
beforeAll(async () => { runtime = await loadPyodide({ indexURL: resolve("public/pyodide") }); }, 120000);

async function grade(code: string, graderId: string, exerciseId: string) {
  return runSubmission(
    { type: "run", requestId: "assessment-test", exerciseId, graderId, files: { "main.py": code } },
    async () => runtime,
  );
}

function checkIds(result: { tests?: { id: string; passed: boolean }[] }): string[] {
  return (result.tests ?? []).filter((t) => t.passed).map((t) => t.id);
}

const CASES: { graderId: string; exerciseId: string; required: string[] }[] = [
  { graderId: "foundations-debug-v1", exerciseId: "foundations-debug-challenge", required: ["concept-except", "sample", "empty", "invalid", "types", "shape"] },
  { graderId: "foundations-scratch-v1", exerciseId: "foundations-scratch-challenge", required: ["sample", "empty", "invalid", "shape"] },
  { graderId: "foundations-project-v1", exerciseId: "foundations-project-challenge", required: ["concept-with", "sample", "empty", "malformed", "case", "shape", "missing-file"] },
  { graderId: "data-debug-v1", exerciseId: "data-debug-challenge", required: ["concept-csv", "concept-decimal", "sample", "empty", "header", "invalid", "shape"] },
  { graderId: "data-scratch-v1", exerciseId: "data-scratch-challenge", required: ["sample", "empty", "precision", "invalid", "shape"] },
  { graderId: "data-project-v1", exerciseId: "data-project-challenge", required: ["concept-json", "sample", "empty", "envelope", "invalid", "duplicates", "shape"] },
  { graderId: "applied-debug-v1", exerciseId: "applied-debug-challenge", required: ["concept-decimal", "sample", "empty", "invalid", "currency", "money", "shape"] },
  { graderId: "applied-scratch-v1", exerciseId: "applied-scratch-challenge", required: ["boundary-199", "boundary-200", "boundary-299", "boundary-300", "retry-429", "retry-500", "client-404", "invalid"] },
  { graderId: "applied-project-v1", exerciseId: "applied-project-challenge", required: ["concept-json", "sample", "empty", "invalid-json", "schema", "money", "shape"] },
];

const REFERENCE: Record<string, string> = {
  "foundations-debug-v1": String.raw`
def clean_users(rows):
    if type(rows) is not list:
        return []
    cleaned = []
    for row in rows:
        if type(row) is not dict:
            continue
        try:
            raw_name = row["name"]
            age = int(row["age"])
        except (KeyError, ValueError, TypeError):
            continue
        if type(raw_name) is not str:
            continue
        name = raw_name.strip()
        if not name or age < 0:
            continue
        cleaned.append({"name": name, "age": age})
    return cleaned
`,
  "foundations-scratch-v1": String.raw`
def dedupe_names(names):
    if type(names) is not list:
        return []
    seen = set()
    result = []
    for value in names:
        if type(value) is not str:
            continue
        name = value.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        result.append(name)
    return result
`,
  "foundations-project-v1": String.raw`
def build_report(path):
    levels = {}
    errors = []
    malformed = 0
    with open(path, "r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line:
                continue
            if ":" not in line:
                malformed += 1
                continue
            level, _, message = line.partition(":")
            level = level.strip().upper()
            message = message.strip()
            if not level:
                malformed += 1
                continue
            levels[level] = levels.get(level, 0) + 1
            if level == "ERROR" and message and message not in errors:
                errors.append(message)
    return {"levels": levels, "errors": errors, "malformed": malformed}
`,
  "data-debug-v1": String.raw`
import csv
import io
from decimal import Decimal, InvalidOperation

def load_orders(text):
    try:
        reader = csv.DictReader(io.StringIO(text))
    except Exception:
        return None
    if reader.fieldnames != ["id", "amount", "currency"]:
        return None
    orders = []
    for row in reader:
        if row.get("id") is None or row.get("amount") is None or row.get("currency") is None:
            continue
        ident = row["id"].strip()
        currency = row["currency"].strip().upper()
        if not ident or currency not in ("USD", "EUR", "GBP"):
            continue
        try:
            amount = Decimal(row["amount"].strip())
        except (InvalidOperation, ValueError, AttributeError):
            continue
        if not amount.is_finite() or amount <= 0:
            continue
        orders.append({
            "id": ident,
            "amount_cents": int((amount * 100).to_integral_value()),
            "currency": currency,
        })
    return orders
`,
  "data-scratch-v1": String.raw`
from decimal import Decimal, InvalidOperation

def group_totals(records):
    if type(records) is not list:
        return {}
    totals = {}
    for row in records:
        if type(row) is not dict:
            continue
        dept = row.get("dept")
        if type(dept) is not str or not dept.strip():
            continue
        try:
            amount = Decimal(str(row.get("amount")).strip())
        except (InvalidOperation, ValueError, AttributeError):
            continue
        if not amount.is_finite():
            continue
        key = dept.strip()
        totals[key] = totals.get(key, Decimal("0")) + amount
    return {key: format(value.quantize(Decimal("0.01")), ".2f") for key, value in totals.items()}
`,
  "data-project-v1": String.raw`
import csv
import io
import json

def reconcile_manifest(manifest_text, confirmed_json):
    try:
        confirmed_raw = json.loads(confirmed_json)
    except (json.JSONDecodeError, TypeError):
        return {"matched": [], "missing": [], "unexpected": []}
    if type(confirmed_raw) is not list:
        return {"matched": [], "missing": [], "unexpected": []}
    confirmed = {entry.strip() for entry in confirmed_raw if type(entry) is str and entry.strip()}
    try:
        reader = csv.DictReader(io.StringIO(manifest_text))
    except Exception:
        return {"matched": [], "missing": [], "unexpected": []}
    if reader.fieldnames != ["id", "status"]:
        return {"matched": [], "missing": [], "unexpected": []}
    seen = set()
    settled = set()
    for row in reader:
        if row.get("id") is None or row.get("status") is None:
            continue
        ident = row["id"].strip()
        status = row["status"].strip().lower()
        if not ident or status not in ("settled", "pending") or ident in seen:
            continue
        seen.add(ident)
        if status == "settled":
            settled.add(ident)
    return {
        "matched": sorted(settled & confirmed),
        "missing": sorted(settled - confirmed),
        "unexpected": sorted(confirmed - seen),
    }
`,
  "applied-debug-v1": String.raw`
from decimal import Decimal, InvalidOperation

def validate_payouts(records):
    if type(records) is not list:
        return []
    valid = []
    for record in records:
        if type(record) is not dict:
            continue
        raw_id = record.get("id")
        raw_amount = record.get("amount")
        raw_currency = record.get("currency")
        if type(raw_id) is not str or type(raw_currency) is not str:
            continue
        ident = raw_id.strip()
        currency = raw_currency.strip().upper()
        if not ident or currency not in ("USD", "EUR", "GBP"):
            continue
        try:
            amount = Decimal(str(raw_amount).strip())
        except (InvalidOperation, ValueError, AttributeError):
            continue
        if not amount.is_finite() or amount <= 0:
            continue
        cents = amount.quantize(Decimal("0.01"))
        if amount != cents:
            continue
        valid.append({"id": ident, "amount": format(cents, ".2f"), "currency": currency})
    return valid
`,
  "applied-scratch-v1": String.raw`
def classify_status(status):
    if type(status) is not int or isinstance(status, bool):
        return "fail"
    if 200 <= status <= 299:
        return "success"
    if status == 429 or 500 <= status <= 599:
        return "retry"
    return "fail"
`,
  "applied-project-v1": String.raw`
import json
from decimal import Decimal, InvalidOperation

def guard_payouts(lines_text):
    accepted = []
    fallback = 0
    if type(lines_text) is not str:
        return {"accepted": [], "fallback": 0}
    for raw in lines_text.splitlines():
        line = raw.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            fallback += 1
            continue
        if type(record) is not dict:
            fallback += 1
            continue
        raw_id = record.get("id")
        raw_amount = record.get("amount")
        raw_currency = record.get("currency")
        if type(raw_id) is not str or type(raw_currency) is not str:
            fallback += 1
            continue
        ident = raw_id.strip()
        currency = raw_currency.strip().upper()
        if not ident or currency not in ("USD", "EUR", "GBP"):
            fallback += 1
            continue
        try:
            amount = Decimal(str(raw_amount).strip())
        except (InvalidOperation, ValueError, AttributeError):
            fallback += 1
            continue
        if not amount.is_finite() or amount <= 0:
            fallback += 1
            continue
        cents = amount.quantize(Decimal("0.01"))
        if amount != cents:
            fallback += 1
            continue
        accepted.append({"id": ident, "amount": format(cents, ".2f"), "currency": currency})
    return {"accepted": accepted, "fallback": fallback}
`,
};

describe("assessment code graders (real Pyodide)", () => {
  for (const { graderId, exerciseId, required } of CASES) {
    test(`${graderId}: reference solution passes every required check`, async () => {
      const result = await grade(REFERENCE[graderId], graderId, exerciseId);
      expect(result.executionOk).toBe(true);
      const missing = required.filter((id) => !checkIds(result).includes(id));
      expect(missing).toEqual([]);
      expect(result.passed).toBe(true);
    }, 120000);
  }

  test("foundations-debug: catching only KeyError fails the malformed-age sample", async () => {
    const mutated = REFERENCE["foundations-debug-v1"].replace(
      "except (KeyError, ValueError, TypeError):",
      "except KeyError:",
    );
    const result = await grade(mutated, "foundations-debug-v1", "foundations-debug-challenge");
    expect(checkIds(result)).not.toContain("sample");
  }, 120000);

  test("foundations-debug: dropping valid age 0 fails the types check", async () => {
    const mutated = REFERENCE["foundations-debug-v1"].replace("if not name or age < 0:", "if not name or age <= 0:");
    const result = await grade(mutated, "foundations-debug-v1", "foundations-debug-challenge");
    expect(checkIds(result)).not.toContain("types");
  }, 120000);

  test("foundations-scratch: case-insensitive dedupe merges distinct names", async () => {
    const mutated = REFERENCE["foundations-scratch-v1"].replace(
      "if not name or name in seen:",
      "if not name or name.lower() in seen:",
    );
    const result = await grade(mutated, "foundations-scratch-v1", "foundations-scratch-challenge");
    expect(checkIds(result)).not.toContain("sample");
  }, 120000);

  test("foundations-project: opening without a with-block fails concept-with", async () => {
    const mutated = REFERENCE["foundations-project-v1"]
      .replace('    with open(path, "r", encoding="utf-8") as handle:', "    handle = open(path, 'r', encoding='utf-8')\n    if True:")
      .replace('    return {"levels": levels, "errors": errors, "malformed": malformed}', '    handle.close()\n    return {"levels": levels, "errors": errors, "malformed": malformed}');
    const result = await grade(mutated, "foundations-project-v1", "foundations-project-challenge");
    expect(checkIds(result)).not.toContain("concept-with");
  }, 120000);

  test("data-debug: manual splitting instead of DictReader fails concept-csv", async () => {
    const mutated = String.raw`
def load_orders(text):
    lines = text.splitlines()
    if not lines or lines[0] != "id,amount,currency":
        return None
    orders = []
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) != 3:
            continue
        ident, amount, currency = parts
        ident = ident.strip()
        currency = currency.strip().upper()
        if not ident or currency not in ("USD", "EUR", "GBP"):
            continue
        try:
            value = float(amount.strip())
        except ValueError:
            continue
        if value <= 0:
            continue
        orders.append({"id": ident, "amount_cents": int(round(value * 100)), "currency": currency})
    return orders
`;
    const result = await grade(mutated, "data-debug-v1", "data-debug-challenge");
    expect(checkIds(result)).not.toContain("concept-csv");
  }, 120000);

  test("data-scratch: float arithmetic fails the precision check", async () => {
    const mutated = String.raw`
def group_totals(records):
    if type(records) is not list:
        return {}
    totals = {}
    for row in records:
        if type(row) is not dict:
            continue
        dept = row.get("dept")
        if type(dept) is not str or not dept.strip():
            continue
        try:
            amount = float(row.get("amount"))
        except (TypeError, ValueError):
            continue
        key = dept.strip()
        totals[key] = totals.get(key, 0.0) + amount
    return {key: format(value, ".2f") for key, value in totals.items()}
`;
    const result = await grade(mutated, "data-scratch-v1", "data-scratch-challenge");
    expect(checkIds(result)).not.toContain("precision");
  }, 120000);

  test("data-project: crashing on a bad JSON envelope fails the envelope check", async () => {
    const mutated = REFERENCE["data-project-v1"].replace(
      `    try:
        confirmed_raw = json.loads(confirmed_json)
    except (json.JSONDecodeError, TypeError):
        return {"matched": [], "missing": [], "unexpected": []}`,
      "    confirmed_raw = json.loads(confirmed_json)",
    );
    const result = await grade(mutated, "data-project-v1", "data-project-challenge");
    expect(checkIds(result)).not.toContain("envelope");
  }, 120000);

  test("applied-debug: accepting three-decimal amounts fails the money check", async () => {
    const mutated = REFERENCE["applied-debug-v1"].replace(
      `        cents = amount.quantize(Decimal("0.01"))
        if amount != cents:
            continue`,
      '        cents = amount.quantize(Decimal("0.01"))',
    );
    const result = await grade(mutated, "applied-debug-v1", "applied-debug-challenge");
    expect(checkIds(result)).not.toContain("money");
  }, 120000);

  test("applied-scratch: treating 300 as success fails the boundary check", async () => {
    const mutated = REFERENCE["applied-scratch-v1"].replace("if 200 <= status <= 299:", "if 200 <= status < 400:");
    const result = await grade(mutated, "applied-scratch-v1", "applied-scratch-challenge");
    expect(checkIds(result)).not.toContain("boundary-300");
  }, 120000);

  test("applied-scratch: forgetting 429 fails the retry check", async () => {
    const mutated = REFERENCE["applied-scratch-v1"].replace(
      "if status == 429 or 500 <= status <= 599:",
      "if 500 <= status <= 599:",
    );
    const result = await grade(mutated, "applied-scratch-v1", "applied-scratch-challenge");
    expect(checkIds(result)).not.toContain("retry-429");
  }, 120000);

  test("applied-project: a bad JSON line must count as fallback, not crash", async () => {
    const mutated = REFERENCE["applied-project-v1"].replace(
      `        try:
            record = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            fallback += 1
            continue`,
      "        record = json.loads(line)",
    );
    const result = await grade(mutated, "applied-project-v1", "applied-project-challenge");
    expect(checkIds(result)).not.toContain("invalid-json");
  }, 120000);
});
