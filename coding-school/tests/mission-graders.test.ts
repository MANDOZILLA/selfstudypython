import { beforeAll, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { resolve } from "node:path";
import { runSubmission } from "../public/grading/runner.js";

let runtime: Awaited<ReturnType<typeof loadPyodide>>;
beforeAll(async () => { runtime = await loadPyodide({ indexURL: resolve("public/pyodide") }); }, 60000);
async function grade(code: string, graderId: string, exerciseId: string) {
  return runSubmission({ type: "run", requestId: "mission-test", exerciseId, graderId, files: { "main.py": code } }, async () => runtime);
}
const jsonReference = `import json
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
it("executes the authored JSON project contract with real Python", async () => {
  expect((await grade(jsonReference, "api-normalization-v1", "api-normalization-challenge")).passed).toBe(true);
});
it.each([
  ["starter", "def solve(value):\n    return []"],
  ["wrong envelope", jsonReference.replace("type(payload.get('payments')) is not list", "False")],
  ["fractional cents", jsonReference.replace("if amount != cents:", "if False:")],
  ["duplicate order", jsonReference.replace(" or identifier in seen", "")],
  ["money numeric coercion", jsonReference.replace("type(money.get('amount')) is not str", "money.get('amount') is None").replace("money['amount'].strip()", "str(money['amount']).strip()")],
  ["float precision", jsonReference.replace("money['amount'].strip()", "str(float(money['amount']))").replace("except InvalidOperation:", "except (InvalidOperation, ValueError):")],
  ["mixed siblings", jsonReference.replace("            continue", "            return []")],
  ["shape", jsonReference.replace("'amount': format(abs(cents), '.2f')", "'amount': float(cents)")],
])("rejects JSON partial behavior: %s", async (_label, source) => {
  expect((await grade(source, "api-normalization-v1", "api-normalization-challenge")).passed).toBe(false);
});
it("grades contact practice including invalid records and duplicate normalization", async () => {
  const source = `def solve(records):
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
  expect((await grade(source, "contacts-v1", "contacts-challenge")).passed).toBe(true);
  expect((await grade(source.replace(" or email in seen", ""), "contacts-v1", "contacts-challenge")).passed).toBe(false);
});
it("grades inventory retrieval and rejects booleans masquerading as integers", async () => {
  const source = `def solve(records):
    if type(records) is not list: return []
    result, seen = [], set()
    for row in records:
        if type(row) is not dict or type(row.get('sku')) is not str or type(row.get('quantity')) is not int: continue
        sku, quantity = row['sku'].strip(), row['quantity']
        if not sku or quantity < 0 or sku in seen: continue
        seen.add(sku)
        result.append({'sku': sku, 'quantity': quantity})
    return result`;
  expect((await grade(source, "inventory-v1", "inventory-challenge")).passed).toBe(true);
  expect((await grade(source.replace("type(row.get('quantity')) is not int", "not isinstance(row.get('quantity'), int)"), "inventory-v1", "inventory-challenge")).passed).toBe(false);
});
it.each([
  ["csv-tags-v1", "csv-tags-challenge", `import csv, io
def solve(text):
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames != ['id','tag']: return []
    result = []
    for row in reader:
        if None in row or any(value is None for value in row.values()): continue
        identifier, tag = row['id'].strip(), row['tag'].strip()
        if identifier and tag: result.append({'id':identifier,'tag':tag})
    return result`],
  ["invoice-cents-v1", "invoice-cents-challenge", `from decimal import Decimal, InvalidOperation
def solve(text):
    if type(text) is not str: return None
    try:
        amount = Decimal(text.strip())
        if not amount.is_finite() or amount < 0: return None
        cents = amount.quantize(Decimal('0.01'))
        if amount != cents: return None
        return int(cents * 100)
    except InvalidOperation:
        return None`],
  ["webhook-events-v1", "webhook-events-challenge", `import json
def solve(text):
    try: payload = json.loads(text)
    except json.JSONDecodeError: return []
    if type(payload) is not dict or type(payload.get('events')) is not list: return []
    result, seen = [], set()
    for row in payload['events']:
        if type(row) is not dict or type(row.get('id')) is not str: continue
        identifier = row['id'].strip()
        if not identifier or identifier in seen: continue
        seen.add(identifier)
        result.append(identifier)
    return result`],
])("provides an executable short review for %s", async (graderId, exerciseId, source) => {
  expect((await grade(source, graderId, exerciseId)).passed).toBe(true);
  expect((await grade("def solve(value):\n    return []", graderId, exerciseId)).passed).toBe(false);
});
