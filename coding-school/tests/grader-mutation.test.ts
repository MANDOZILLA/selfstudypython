import { beforeAll, describe, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { resolve } from "node:path";
import { runSubmission } from "../public/grading/runner.js";

/**
 * Grader mutation tests: for a sample of graders across the diagnostic,
 * mission, and assessment layers, a correct submission must PASS and a
 * deliberately mutated submission must FAIL. A grader that cannot tell the
 * difference is untrustworthy and fails closed here.
 */
let runtime: Awaited<ReturnType<typeof loadPyodide>>;
beforeAll(async () => { runtime = await loadPyodide({ indexURL: resolve("public/pyodide") }); }, 120000);

async function grade(code: string, graderId: string, exerciseId: string) {
  return runSubmission(
    { type: "run", requestId: `mutation-${graderId}`, exerciseId, graderId, files: { "main.py": code } },
    async () => runtime,
  );
}

const HTTP_CORRECT = `def is_success(status):\n    return 200 <= status < 300\n`;
const HTTP_MUTANT = `def is_success(status):\n    return status == 200\n`;

const CONTACTS_CORRECT = `def solve(records):
    if type(records) is not list: return []
    result, seen = [], set()
    for row in records:
        if type(row) is not dict or type(row.get('email')) is not str: continue
        email = row['email'].strip().lower()
        parts = email.split('@')
        if len(parts) != 2 or not all(parts) or any(c.isspace() for c in email) or email in seen: continue
        seen.add(email)
        result.append(email)
    return result`;
const CONTACTS_MUTANT = CONTACTS_CORRECT.replace(" or email in seen", "");

const JSON_CORRECT = `import json
from decimal import Decimal, InvalidOperation
def solve(json_text):
    try:
        payload = json.loads(json_text)
    except (json.JSONDecodeError, TypeError):
        return []
    if type(payload) is not dict or type(payload.get('payments')) is not list:
        return []
    result, seen = [], set()
    for row in payload['payments']:
        if type(row) is not dict or type(row.get('id')) is not str or type(row.get('money')) is not dict:
            continue
        money = row['money']
        if type(money.get('amount')) is not str or type(money.get('currency')) is not str:
            continue
        identifier, currency = row['id'].strip(), money['currency'].strip().upper()
        try:
            amount = Decimal(money['amount'].strip())
            if not amount.is_finite() or amount < 0:
                continue
            cents = amount.quantize(Decimal('0.01'))
            if amount != cents:
                continue
        except InvalidOperation:
            continue
        if not identifier or currency not in {'USD','EUR','GBP'} or identifier in seen:
            continue
        seen.add(identifier)
        result.append({'id': identifier, 'amount': format(abs(cents), '.2f'), 'currency': currency})
    return result
`;
const JSON_MUTANT = JSON_CORRECT.replace(" or identifier in seen", "");

const DEBUG_CORRECT = `
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
`;
const DEBUG_MUTANT = DEBUG_CORRECT.replace(
  "except (KeyError, ValueError, TypeError):",
  "except KeyError:",
);

const SCRATCH_CORRECT = `
def classify_status(status):
    if type(status) is not int or isinstance(status, bool):
        return "fail"
    if 200 <= status <= 299:
        return "success"
    if status == 429 or 500 <= status <= 599:
        return "retry"
    return "fail"
`;
const SCRATCH_MUTANT = SCRATCH_CORRECT.replace("if 200 <= status <= 299:", "if 200 <= status <= 300:");

const PANDAS_CORRECT = `import io
import pandas as pd

def solve(csv_text):
    if type(csv_text) is not str or not csv_text.strip():
        return []
    try:
        df = pd.read_csv(io.StringIO(csv_text), dtype=str, keep_default_na=False)
    except Exception:
        return []
    if list(df.columns) != ["id", "region", "amount", "qty"]:
        return []
    df = df[df["id"].fillna("").str.strip() != ""].copy()
    if df.empty:
        return []
    df["region"] = df["region"].fillna("").str.strip().replace("", "unknown")
    amounts = pd.to_numeric(df["amount"].fillna("").str.strip(), errors="coerce")
    median = amounts.median()
    fill = float(median) if pd.notna(median) else 0.0
    df["amount"] = amounts.fillna(fill).astype(float)
    df["qty"] = pd.to_numeric(df["qty"].fillna("").str.strip(), errors="coerce").fillna(0).astype(int)
    return [
        {"id": str(i).strip(), "region": str(r), "amount": float(a), "qty": int(q)}
        for i, r, a, q in zip(df["id"], df["region"], df["amount"], df["qty"])
    ]
`;
// Fills missing amounts with 0 instead of the column median: the "missing"
// check must catch it.
const PANDAS_MUTANT = PANDAS_CORRECT.replace(
  "    fill = float(median) if pd.notna(median) else 0.0",
  "    fill = 0.0",
);

const CASES: { graderId: string; exerciseId: string; correct: string; mutant: string; mutantWhy: string }[] = [
  { graderId: "diagnostic-http-v1", exerciseId: "diagnostic-http", correct: HTTP_CORRECT, mutant: HTTP_MUTANT, mutantWhy: "treats only 200 as success" },
  { graderId: "contacts-v1", exerciseId: "contacts-challenge", correct: CONTACTS_CORRECT, mutant: CONTACTS_MUTANT, mutantWhy: "keeps duplicate emails" },
  { graderId: "api-normalization-v1", exerciseId: "api-normalization-challenge", correct: JSON_CORRECT, mutant: JSON_MUTANT, mutantWhy: "keeps duplicate payment ids" },
  { graderId: "foundations-debug-v1", exerciseId: "foundations-debug-challenge", correct: DEBUG_CORRECT, mutant: DEBUG_MUTANT, mutantWhy: "catches only KeyError" },
  { graderId: "applied-scratch-v1", exerciseId: "applied-scratch-challenge", correct: SCRATCH_CORRECT, mutant: SCRATCH_MUTANT, mutantWhy: "treats 300 as success" },
  { graderId: "pandas-clean-v1", exerciseId: "pandas-clean-challenge", correct: PANDAS_CORRECT, mutant: PANDAS_MUTANT, mutantWhy: "fills missing amounts with 0 instead of the median" },
];

describe("grader mutation", () => {
  for (const { graderId, exerciseId, correct, mutant, mutantWhy } of CASES) {
    it(`${graderId}: correct submission passes`, async () => {
      const result = await grade(correct, graderId, exerciseId);
      expect(result.passed, `${graderId}: correct submission failed: ${JSON.stringify((result.tests ?? []).filter((t: { passed: boolean }) => !t.passed).map((t: { id: string }) => t.id))}`).toBe(true);
    }, 120000);
    it(`${graderId}: mutated submission fails (${mutantWhy})`, async () => {
      const result = await grade(mutant, graderId, exerciseId);
      expect(result.passed, `${graderId}: mutant passed — grader cannot discriminate`).toBe(false);
    }, 120000);
  }
});
