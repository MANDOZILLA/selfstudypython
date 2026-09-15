import { beforeAll, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { resolve } from "node:path";
import { runSubmission } from "../public/grading/runner.js";

let runtime: Awaited<ReturnType<typeof loadPyodide>>;
beforeAll(async () => { runtime = await loadPyodide({ indexURL: resolve("public/pyodide") }); }, 60000);
async function grade(code: string, graderId: string, exerciseId: string) {
  return runSubmission({ type: "run", requestId: "mission2-test", exerciseId, graderId, files: { "main.py": code } }, async () => runtime);
}

const tracebackReference = `import re
def solve(text):
    empty = {"type": "", "message": "", "frames": []}
    if type(text) is not str:
        return empty
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if line == "Traceback (most recent call last):"]
    block = lines[starts[-1] + 1:] if starts else lines
    frames = []
    for line in block:
        match = re.match(r'^\\s*File "([^"]+)", line (\\d+)(?:, in (\\S+))?', line)
        if match:
            frames.append({"file": match.group(1), "line": int(match.group(2)), "function": match.group(3) or ""})
    candidate = ""
    for line in block:
        if not line or line[0] in " \\t":
            continue
        if line.startswith(("Traceback", "File \\"", "During handling", "The above", "The direct")):
            continue
        match = re.match(r"^([\\w.]+)(?::\\s?(.*))?$", line)
        if match:
            candidate = (match.group(1).split(".")[-1], match.group(2) or "")
    if not candidate:
        return empty
    return {"type": candidate[0], "message": candidate[1], "frames": frames}
`;
it("grades traceback parsing with real Python", async () => {
  expect((await grade(tracebackReference, "traceback-v1", "traceback-challenge")).passed).toBe(true);
});
it.each([
  ["no frames", tracebackReference.replace("            frames.append(", "            pass  # frames.append(")],
  ["wrong exception", tracebackReference.replace("starts[-1]", "starts[0]")],
  ["message dropped", tracebackReference.replace('match.group(2) or ""', '""')],
])("rejects traceback bug: %s", async (_label, source) => {
  expect((await grade(source, "traceback-v1", "traceback-challenge")).passed).toBe(false);
});

const logscanReference = `def solve(path):
    counts = {"error": 0, "warning": 0, "info": 0}
    if type(path) is not str:
        return counts
    try:
        with open(path) as handle:
            for line in handle:
                text = line.lstrip()
                if text.startswith("ERROR"):
                    counts["error"] += 1
                elif text.startswith("WARN"):
                    counts["warning"] += 1
                elif text.startswith("INFO"):
                    counts["info"] += 1
    except OSError:
        return {"error": 0, "warning": 0, "info": 0}
    return counts
`;
it("grades log scanning with real file I/O", async () => {
  expect((await grade(logscanReference, "logscan-v1", "logscan-challenge")).passed).toBe(true);
});
const logscanNoWith = `def solve(path):
    counts = {"error": 0, "warning": 0, "info": 0}
    if type(path) is not str:
        return counts
    try:
        handle = open(path)
        for line in handle:
            text = line.lstrip()
            if text.startswith("ERROR"):
                counts["error"] += 1
            elif text.startswith("WARN"):
                counts["warning"] += 1
            elif text.startswith("INFO"):
                counts["info"] += 1
        handle.close()
    except OSError:
        return {"error": 0, "warning": 0, "info": 0}
    return counts
`;
it.each([
  ["no context manager", logscanNoWith],
  ["counts everything", logscanReference.replace('counts["info"] += 1', 'counts["error"] += 1')],
])("rejects log scan bug: %s", async (_label, source) => {
  expect((await grade(source, "logscan-v1", "logscan-challenge")).passed).toBe(false);
});

const validatorsReference = `def is_valid_username(value):
    if type(value) is not str:
        return None
    name = value.strip()
    if not (3 <= len(name) <= 20):
        return None
    if not all(ch.isalnum() or ch == "_" for ch in name):
        return None
    return name

def is_valid_age(value):
    return type(value) is int and 13 <= value <= 120

def solve(users):
    if type(users) is not list:
        return []
    result = []
    for row in users:
        if type(row) is not dict:
            continue
        username = is_valid_username(row.get("username"))
        if username is None or not is_valid_age(row.get("age")):
            continue
        result.append(username)
    return result
`;
const validatorsNoHelper = `def solve(users):
    if type(users) is not list:
        return []
    result = []
    for row in users:
        if type(row) is not dict:
            continue
        name = row.get("username")
        if type(name) is not str:
            continue
        name = name.strip()
        if not (3 <= len(name) <= 20) or not all(ch.isalnum() or ch == "_" for ch in name):
            continue
        age = row.get("age")
        if type(age) is not int or not (13 <= age <= 120):
            continue
        result.append(name)
    return result
`;
it("grades reusable validators with real Python", async () => {
  expect((await grade(validatorsReference, "validators-v1", "validators-challenge")).passed).toBe(true);
});
it.each([
  ["inlined helpers", validatorsNoHelper],
  ["username coerced", validatorsReference.replace("    if type(value) is not str:\n        return None\n    name = value.strip()", "    name = str(value).strip()")],
  ["age range dropped", validatorsReference.replace("13 <= value <= 120", "value >= 0")],
  ["short names", validatorsReference.replace("3 <= len(name) <= 20", "1 <= len(name) <= 20")],
])("rejects validator bug: %s", async (_label, source) => {
  expect((await grade(source, "validators-v1", "validators-challenge")).passed).toBe(false);
});

const transformReference = `from decimal import Decimal, InvalidOperation

def valid_item(item):
    if type(item) is not dict:
        return None
    if type(item.get("sku")) is not str or not item["sku"].strip():
        return None
    if type(item.get("qty")) is not int or item["qty"] < 0:
        return None
    if type(item.get("price")) is not str:
        return None
    try:
        price = Decimal(item["price"].strip())
    except InvalidOperation:
        return None
    if not price.is_finite() or price < 0:
        return None
    return item["qty"], price

def solve(orders):
    if type(orders) is not list:
        return []
    groups = {}
    for order in orders:
        if type(order) is not dict:
            continue
        customer = order.get("customer")
        if type(customer) is not str or not customer.strip():
            continue
        customer = customer.strip()
        if type(order.get("items")) is not list:
            continue
        entries = [entry for entry in (valid_item(item) for item in order["items"]) if entry is not None]
        if not entries:
            continue
        if customer not in groups:
            groups[customer] = [0, 0, Decimal("0")]
        groups[customer][0] += 1
        groups[customer][1] += sum(qty for qty, _ in entries)
        groups[customer][2] += sum((qty * price for qty, price in entries), Decimal("0"))
    return [{"customer": name, "orders": counts[0], "items": counts[1], "total": format(counts[2].quantize(Decimal("0.01")), ".2f")}
            for name, counts in sorted(groups.items())]
`;
const transformNoComp = transformReference
  .replace('        entries = [entry for entry in (valid_item(item) for item in order["items"]) if entry is not None]', '        entries = []\n        for item in order["items"]:\n            entry = valid_item(item)\n            if entry is not None:\n                entries.append(entry)')
  .replace('        groups[customer][1] += sum(qty for qty, _ in entries)', '        for qty, _price in entries:\n            groups[customer][1] += qty')
  .replace('        groups[customer][2] += sum((qty * price for qty, price in entries), Decimal("0"))', '        for qty, price in entries:\n            groups[customer][2] += qty * price')
  .replace('    return [{"customer": name, "orders": counts[0], "items": counts[1], "total": format(counts[2].quantize(Decimal("0.01")), ".2f")}\n            for name, counts in sorted(groups.items())]',
    '    result = []\n    for name, counts in sorted(groups.items()):\n        result.append({"customer": name, "orders": counts[0], "items": counts[1], "total": format(counts[2].quantize(Decimal("0.01")), ".2f")})\n    return result');
it("grades order transformations with real Python", async () => {
  expect((await grade(transformReference, "transform-v1", "transform-challenge")).passed).toBe(true);
});
it.each([
  ["loops only", transformNoComp],
  ["bool qty", transformReference.replace('type(item.get("qty")) is not int', 'not isinstance(item.get("qty"), int)')],
  ["float money", transformReference.replace("price = Decimal(item[\"price\"].strip())", "price = Decimal(str(float(item[\"price\"].strip())))")],
])("rejects transformation bug: %s", async (_label, source) => {
  expect((await grade(source, "transform-v1", "transform-challenge")).passed).toBe(false);
});

const pandasCleanReference = `import io
import pandas as pd

def solve(csv_text):
    if type(csv_text) is not str or not csv_text.strip():
        return []
    df = pd.read_csv(io.StringIO(csv_text))
    for col in ("id", "region", "amount", "qty"):
        if col not in df.columns:
            return []
    df["id"] = df["id"].astype(object).where(df["id"].notna(), "").astype(str).str.strip()
    df = df[df["id"] != ""].copy()
    if df.empty:
        return []
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    median = df["amount"].median()
    if pd.isna(median):
        median = 0.0
    df["amount"] = df["amount"].fillna(median).round(2)
    qty_num = pd.to_numeric(df["qty"], errors="coerce")
    df["qty"] = qty_num.where(qty_num.notna() & (qty_num % 1 == 0), 0).astype(int)
    df["region"] = df["region"].astype(object).where(df["region"].notna(), "").astype(str).str.strip().replace("", "unknown")
    df = df.sort_values("id")
    return [{"id": str(row["id"]), "region": str(row["region"]), "amount": float(row["amount"]), "qty": int(row["qty"])}
            for _, row in df.iterrows()]
`;
const pandasCleanNoPandas = `import csv
import io

def solve(csv_text):
    if type(csv_text) is not str or not csv_text.strip():
        return []
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = [row for row in reader if (row.get("id") or "").strip()]
    return [{"id": row["id"].strip(), "region": (row.get("region") or "unknown").strip() or "unknown",
             "amount": float(row["amount"] or 0), "qty": int(row["qty"] or 0)} for row in rows]
`;
it("grades pandas cleaning fully offline with real Pyodide", async () => {
  expect((await grade(pandasCleanReference, "pandas-clean-v1", "pandas-clean-challenge")).passed).toBe(true);
}, 120000);
it.each([
  ["no pandas", pandasCleanNoPandas],
  ["mean not median", pandasCleanReference.replace(".median()", ".mean()")],
  ["keeps blank ids", pandasCleanReference.replace('df = df[df["id"] != ""].copy()', "df = df.copy()")],
])("rejects pandas cleaning bug: %s", async (_label, source) => {
  expect((await grade(source, "pandas-clean-v1", "pandas-clean-challenge")).passed).toBe(false);
}, 120000);

const pandasProjectReference = `import io
import pandas as pd

def solve(csv_text):
    report = {"rows_in": 0, "rows_out": 0, "dropped": 0,
              "fill_report": {"amount": "median", "region": "unknown"}, "by_region": []}
    if type(csv_text) is not str or not csv_text.strip():
        return report
    df = pd.read_csv(io.StringIO(csv_text))
    for col in ("id", "region", "amount"):
        if col not in df.columns:
            return report
    report["rows_in"] = int(len(df))
    df["id"] = df["id"].astype(object).where(df["id"].notna(), "").astype(str).str.strip()
    df = df[df["id"] != ""].copy()
    report["rows_out"] = int(len(df))
    report["dropped"] = report["rows_in"] - report["rows_out"]
    if df.empty:
        return report
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    median = df["amount"].median()
    if pd.isna(median):
        median = 0.0
    df["amount"] = df["amount"].fillna(median).round(2)
    df["region"] = df["region"].astype(object).where(df["region"].notna(), "").astype(str).str.strip().replace("", "unknown")
    grouped = df.groupby("region", as_index=False).agg(orders=("id", "count"), total=("amount", "sum"))
    grouped["total"] = grouped["total"].round(2)
    grouped = grouped.sort_values(["total", "region"], ascending=[False, True])
    report["by_region"] = [{"region": str(row["region"]), "orders": int(row["orders"]), "total": float(row["total"])}
                           for _, row in grouped.iterrows()]
    return report
`;
it("grades the pandas quality project fully offline", async () => {
  expect((await grade(pandasProjectReference, "pandas-project-v1", "pandas-quality-project")).passed).toBe(true);
}, 120000);
it.each([
  ["no pandas", pandasCleanNoPandas.replace("return []", "return {\"rows_in\": 0, \"rows_out\": 0, \"dropped\": 0, \"fill_report\": {\"amount\": \"median\", \"region\": \"unknown\"}, \"by_region\": []}")],
  ["drops missing amounts", pandasProjectReference.replace('df["amount"] = df["amount"].fillna(median).round(2)', 'df = df.dropna(subset=["amount"])')],
  ["ascending totals", pandasProjectReference.replace("ascending=[False, True]", "ascending=[True, True]")],
])("rejects pandas project bug: %s", async (_label, source) => {
  expect((await grade(source, "pandas-project-v1", "pandas-quality-project")).passed).toBe(false);
}, 120000);

const sqliteAggReference = `import os
import sqlite3

def solve(db_path):
    if type(db_path) is not str or not os.path.isfile(db_path):
        return []
    query = """
        SELECT COALESCE(c.region, 'unknown') AS region,
               COUNT(o.id) AS orders,
               ROUND(SUM(o.amount), 2) AS total
        FROM customers c
        JOIN orders o ON o.customer_id = c.id
        GROUP BY COALESCE(c.region, 'unknown')
        ORDER BY total DESC, region ASC
    """
    try:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(query).fetchall()
    except Exception:
        return []
    return [{"region": str(row["region"]), "orders": int(row["orders"]), "total": float(row["total"])}
            for row in rows]
`;
const sqliteAggNoWith = sqliteAggReference.replace(
  "        with sqlite3.connect(db_path) as conn:\n            conn.row_factory = sqlite3.Row\n            rows = conn.execute(query).fetchall()",
  "        conn = sqlite3.connect(db_path)\n        conn.row_factory = sqlite3.Row\n        rows = conn.execute(query).fetchall()\n        conn.close()");
it("grades sqlite aggregation with real sqlite3", async () => {
  expect((await grade(sqliteAggReference, "sqlite-agg-v1", "sqlite-agg-challenge")).passed).toBe(true);
}, 120000);
it.each([
  ["no context manager", sqliteAggNoWith],
  ["cartesian join", sqliteAggReference.replace("ON o.customer_id = c.id", "ON 1 = 1")],
  ["null region unhandled", sqliteAggReference.replace("COALESCE(c.region, 'unknown') AS region,", "c.region AS region,").replace("GROUP BY COALESCE(c.region, 'unknown')", "GROUP BY c.region")],
])("rejects sqlite aggregation bug: %s", async (_label, source) => {
  expect((await grade(source, "sqlite-agg-v1", "sqlite-agg-challenge")).passed).toBe(false);
}, 120000);

const sqliteProjectReference = `import os
import sqlite3
from decimal import Decimal, InvalidOperation

def to_cents(value):
    if type(value) is not str:
        return None
    try:
        amount = Decimal(value)
    except InvalidOperation:
        return None
    if not amount.is_finite() or amount <= 0:
        return None
    scaled = amount * 100
    if scaled != scaled.to_integral_value():
        return None
    return int(scaled)

def solve(db_path, entries):
    report = {"inserted": 0, "rejected": 0, "total": "0.00"}
    if type(db_path) is not str or not os.path.isfile(db_path):
        return dict(report)
    if type(entries) is not list:
        return dict(report)
    try:
        with sqlite3.connect(db_path) as conn:
            valid_ids = {row[0] for row in conn.execute("SELECT id FROM customers").fetchall()}
            total_cents = 0
            for entry in entries:
                customer_id = entry.get("customer_id") if type(entry) is dict else None
                cents = to_cents(entry.get("amount")) if type(entry) is dict else None
                if type(customer_id) is not int or customer_id not in valid_ids or cents is None:
                    report["rejected"] += 1
                    continue
                note = entry.get("note")
                conn.execute("INSERT INTO ledger (customer_id, amount_cents, note) VALUES (?, ?, ?)",
                             (customer_id, cents, note if type(note) is str else None))
                report["inserted"] += 1
                total_cents += cents
            report["total"] = str((Decimal(total_cents) / 100).quantize(Decimal("0.01")))
    except Exception:
        return {"inserted": 0, "rejected": 0, "total": "0.00"}
    return report
`;
const sqliteProjectNoWith = sqliteProjectReference
  .replace("        with sqlite3.connect(db_path) as conn:", "        conn = sqlite3.connect(db_path)\n        if True:")
  .replace("    except Exception:", "        conn.commit()\n        conn.close()\n    except Exception:");
const sqliteProjectNoCommit = sqliteProjectReference
  .replace("        with sqlite3.connect(db_path) as conn:", "        conn = sqlite3.connect(db_path)\n        if True:")
  .replace("    except Exception:", "        conn.close()\n    except Exception:");
it("grades the sqlite ledger project with real sqlite3", async () => {
  expect((await grade(sqliteProjectReference, "sqlite-project-v1", "sqlite-project-challenge")).passed).toBe(true);
}, 120000);
it.each([
  ["no context manager", sqliteProjectNoWith],
  ["no commit", sqliteProjectNoCommit],
  ["rejects nothing", sqliteProjectReference.replace("if type(customer_id) is not int or customer_id not in valid_ids or cents is None:", "if False:")],
])("rejects sqlite project bug: %s", async (_label, source) => {
  expect((await grade(source, "sqlite-project-v1", "sqlite-project-challenge")).passed).toBe(false);
}, 120000);

const moneyReconReference = `from decimal import Decimal, InvalidOperation

def parse_amount(value):
    if type(value) is not str:
        return None
    try:
        amount = Decimal(value)
    except InvalidOperation:
        return None
    if not amount.is_finite() or amount <= 0:
        return None
    if amount != amount.quantize(Decimal("0.01")):
        return None
    return amount

def solve(transactions):
    report = {"balanced": True, "total": "0.00", "anomalies": []}
    if type(transactions) is not list:
        return dict(report)
    seen = set()
    total = Decimal("0")
    for entry in transactions:
        if type(entry) is not dict or type(entry.get("id")) is not str:
            continue
        tx_id = entry["id"]
        amount = parse_amount(entry.get("amount"))
        tx_type = entry.get("type")
        if tx_id in seen or amount is None or tx_type not in ("credit", "debit"):
            report["anomalies"].append(tx_id)
            continue
        seen.add(tx_id)
        total += amount if tx_type == "credit" else -amount
    report["total"] = str(total.quantize(Decimal("0.01")))
    report["balanced"] = total == 0
    return report
`;
const moneyReconFloat = moneyReconReference
  .replace('    total = Decimal("0")', '    total = 0.0')
  .replace("        total += amount if tx_type == \"credit\" else -amount", "        total += float(amount) if tx_type == \"credit\" else -float(amount)")
  .replace('    report["total"] = str(total.quantize(Decimal("0.01")))', '    report["total"] = str(round(total, 2))')
  .replace("    report[\"balanced\"] = total == 0", "    report[\"balanced\"] = round(total, 2) == 0");
it("grades money reconciliation with exact decimals", async () => {
  expect((await grade(moneyReconReference, "money-recon-v1", "money-recon-challenge")).passed).toBe(true);
});
it.each([
  ["float arithmetic", moneyReconFloat],
  ["no duplicate detection", moneyReconReference.replace('if tx_id in seen or amount is None or tx_type not in ("credit", "debit"):', 'if amount is None or tx_type not in ("credit", "debit"):')],
  ["anomalies not reported", moneyReconReference.replace('            report["anomalies"].append(tx_id)\n', "")],
])("rejects money reconciliation bug: %s", async (_label, source) => {
  expect((await grade(source, "money-recon-v1", "money-recon-challenge")).passed).toBe(false);
});

const moneyProjectReference = `import io
from decimal import Decimal, InvalidOperation
import pandas as pd

def parse_amount(value):
    if type(value) is not str:
        return None
    try:
        amount = Decimal(value.strip())
    except InvalidOperation:
        return None
    if not amount.is_finite() or amount <= 0:
        return None
    if amount != amount.quantize(Decimal("0.01")):
        return None
    return amount

def solve(csv_text):
    report = {"rows": 0, "flagged": [], "net": "0.00"}
    if type(csv_text) is not str or not csv_text.strip():
        return report
    df = pd.read_csv(io.StringIO(csv_text), dtype=str, keep_default_na=False)
    for col in ("id", "amount", "type"):
        if col not in df.columns:
            return report
    report["rows"] = int(len(df))
    seen = set()
    net = Decimal("0")
    for _, row in df.iterrows():
        tx_id = row["id"].strip()
        if not tx_id:
            continue
        amount = parse_amount(row["amount"])
        tx_type = row["type"].strip()
        if tx_id in seen or amount is None or tx_type not in ("credit", "debit"):
            report["flagged"].append(tx_id)
            continue
        seen.add(tx_id)
        net += amount if tx_type == "credit" else -amount
    report["net"] = str(net.quantize(Decimal("0.01")))
    return report
`;
const moneyProjectFloat = moneyProjectReference
  .replace('    net = Decimal("0")', '    net = 0.0')
  .replace("        net += amount if tx_type == \"credit\" else -amount", "        net += float(amount) if tx_type == \"credit\" else -float(amount)")
  .replace('    report["net"] = str(net.quantize(Decimal("0.01")))', '    report["net"] = str(round(net, 2))');
it("grades the money anomaly project with pandas", async () => {
  expect((await grade(moneyProjectReference, "money-project-v1", "money-project-challenge")).passed).toBe(true);
}, 120000);
it.each([
  ["no pandas", moneyReconReference.replace("def solve(transactions):", "def solve(csv_text):").replace("if type(transactions) is not list:", "if type(csv_text) is not str:")],
  ["float net", moneyProjectFloat],
  ["flags nothing", moneyProjectReference.replace('            report["flagged"].append(tx_id)\n', "")],
])("rejects money project bug: %s", async (_label, source) => {
  expect((await grade(source, "money-project-v1", "money-project-challenge")).passed).toBe(false);
}, 120000);

const httpClientReference = `def retry_delay(headers):
    for key, value in headers.items():
        if key.lower() == "retry-after":
            try:
                return min(float(value), 60.0)
            except (TypeError, ValueError):
                return 1.0
    return 1.0

def solve(transport, url, sleep):
    attempts = 0
    status, headers, body = 0, {}, ""
    while attempts < 3:
        attempts += 1
        status, headers, body = transport("GET", url)
        if 200 <= status <= 299:
            return {"ok": True, "status": status, "body": body, "attempts": attempts}
        if status == 429 and attempts < 3:
            sleep(retry_delay(headers))
            continue
        if 500 <= status <= 599 and attempts < 3:
            sleep(float(attempts))
            continue
        return {"ok": False, "status": status, "body": body, "attempts": attempts}
    return {"ok": False, "status": status, "body": body, "attempts": attempts}
`;
it("grades the http client with an injected fake transport", async () => {
  expect((await grade(httpClientReference, "http-client-v1", "http-client-challenge")).passed).toBe(true);
});
it.each([
  ["retries client errors", httpClientReference.replace("if 500 <= status <= 599 and attempts < 3:", "if attempts < 3:")],
  ["ignores retry-after", httpClientReference.replace("return min(float(value), 60.0)", "return 1.0")],
  ["boundary off-by-one", httpClientReference.replace("if 200 <= status <= 299:", "if 200 <= status < 299:")],
])("rejects http client bug: %s", async (_label, source) => {
  expect((await grade(source, "http-client-v1", "http-client-challenge")).passed).toBe(false);
});

const httpProjectReference = `import json as json_module

def request_with_retry(transport, url, sleep):
    attempts = 0
    status, headers, body = 0, {}, ""
    while attempts < 3:
        attempts += 1
        status, headers, body = transport("GET", url)
        if 200 <= status <= 299:
            return ("ok", status, body)
        if status == 429 and attempts < 3:
            delay = 1.0
            for key, value in headers.items():
                if key.lower() == "retry-after":
                    try:
                        delay = min(float(value), 60.0)
                    except (TypeError, ValueError):
                        delay = 1.0
            sleep(delay)
            continue
        if 500 <= status <= 599 and attempts < 3:
            sleep(float(attempts))
            continue
        return ("error", status, body)
    return ("error", status, body)

def solve(transport, base_url, sleep):
    result = {"items": [], "pages": 0, "ok": False}
    if not callable(transport) or type(base_url) is not str or not callable(sleep):
        return result
    url = base_url
    seen = set()
    while url is not None and result["pages"] < 10:
        if url in seen:
            break
        seen.add(url)
        outcome, status, body = request_with_retry(transport, url, sleep)
        if outcome != "ok":
            return result
        try:
            data = json_module.loads(body)
        except Exception:
            return result
        if type(data) is not dict or type(data.get("items")) is not list:
            return result
        result["items"].extend(data["items"])
        result["pages"] += 1
        nxt = data.get("next")
        if type(nxt) is str and nxt.startswith("/"):
            url = nxt
        else:
            url = None
    result["ok"] = True
    return result
`;
it("grades the http pagination project with an injected fake transport", async () => {
  expect((await grade(httpProjectReference, "http-project-v1", "http-project-challenge")).passed).toBe(true);
});
it.each([
  ["no page limit", httpProjectReference.replace("while url is not None and result[\"pages\"] < 10:", "while url is not None:")],
  ["no retries", httpProjectReference.replace("if 500 <= status <= 599 and attempts < 3:", "if False:")],
  ["follows absolute next", httpProjectReference.replace('if type(nxt) is str and nxt.startswith("/"):', "if type(nxt) is str:")],
])("rejects http project bug: %s", async (_label, source) => {
  expect((await grade(source, "http-project-v1", "http-project-challenge")).passed).toBe(false);
});

const llmGuardReference = `import json

FIELDS = ("name", "age", "email")

def check_name(value):
    if value is None:
        return "missing_name"
    if type(value) is not str or not value.strip():
        return "bad_name"
    return None

def check_age(value):
    if value is None:
        return "missing_age"
    if type(value) is bool or type(value) is not int or not 0 <= value <= 120:
        return "bad_age"
    return None

def check_email(value):
    if value is None:
        return "missing_email"
    if type(value) is not str or "@" not in value.strip():
        return "bad_email"
    return None

CHECKS = {"name": check_name, "age": check_age, "email": check_email}

def solve(raw_text):
    if type(raw_text) is not str:
        return {"ok": False, "data": None, "errors": ["invalid_json"]}
    try:
        data = json.loads(raw_text)
    except Exception:
        return {"ok": False, "data": None, "errors": ["invalid_json"]}
    if type(data) is not dict:
        return {"ok": False, "data": None, "errors": ["not_an_object"]}
    errors = []
    for field in FIELDS:
        error = CHECKS[field](data.get(field))
        if error is not None:
            errors.append(error)
    if errors:
        return {"ok": False, "data": None, "errors": errors}
    return {"ok": True,
            "data": {"name": data["name"].strip(), "age": data["age"], "email": data["email"].strip()},
            "errors": []}
`;
const llmGuardInputOrder = llmGuardReference.replace(
  '    errors = []\n    for field in FIELDS:\n        error = CHECKS[field](data.get(field))\n        if error is not None:\n            errors.append(error)',
  '    errors = []\n    for field in data:\n        if field in CHECKS:\n            error = CHECKS[field](data.get(field))\n            if error is not None:\n                errors.append(error)');
it("grades llm output validation deterministically", async () => {
  expect((await grade(llmGuardReference, "llm-guard-v1", "llm-guard-challenge")).passed).toBe(true);
});
it.each([
  ["input-order errors", llmGuardInputOrder],
  ["accepts bool age", llmGuardReference.replace("if type(value) is bool or type(value) is not int or not 0 <= value <= 120:", "if not isinstance(value, int) or not 0 <= value <= 120:")],
  ["no json guard", llmGuardReference.replace('    try:\n        data = json.loads(raw_text)\n    except Exception:\n        return {"ok": False, "data": None, "errors": ["invalid_json"]}', "    data = json.loads(raw_text)")],
])("rejects llm guard bug: %s", async (_label, source) => {
  expect((await grade(source, "llm-guard-v1", "llm-guard-challenge")).passed).toBe(false);
});

const llmProjectReference = `import json

FIELDS = ("name", "age", "email")

def validate_text(raw_text):
    if type(raw_text) is not str:
        return {"ok": False, "data": None, "errors": ["invalid_json"]}
    try:
        data = json.loads(raw_text)
    except Exception:
        return {"ok": False, "data": None, "errors": ["invalid_json"]}
    if type(data) is not dict:
        return {"ok": False, "data": None, "errors": ["not_an_object"]}
    errors = []
    clean = {}
    for field in FIELDS:
        value = data.get(field)
        if field == "name":
            if type(value) is not str or not value.strip():
                errors.append("bad_name" if value is not None else "missing_name")
            else:
                clean["name"] = value.strip()
        elif field == "age":
            if type(value) is bool or type(value) is not int or not 0 <= value <= 120:
                errors.append("bad_age" if value is not None else "missing_age")
            else:
                clean["age"] = value
        elif field == "email":
            if type(value) is not str or "@" not in value.strip():
                errors.append("bad_email" if value is not None else "missing_email")
            else:
                clean["email"] = value.strip()
    if errors:
        return {"ok": False, "data": None, "errors": errors}
    return {"ok": True, "data": clean, "errors": []}

def solve(model, prompt):
    if not callable(model) or type(prompt) is not str:
        return {"ok": False, "data": None, "errors": ["bad_input"], "attempts": 0}
    attempts = 0
    last_errors = ["no_response"]
    while attempts < 3:
        attempts += 1
        try:
            raw = model(prompt, attempts)
        except Exception:
            last_errors = ["model_error"]
            continue
        verdict = validate_text(raw)
        if verdict["ok"]:
            return {"ok": True, "data": verdict["data"], "errors": [], "attempts": attempts}
        last_errors = verdict["errors"]
    return {"ok": False, "data": None, "errors": last_errors, "attempts": attempts}
`;
it("grades the llm pipeline project with an injected fake model", async () => {
  expect((await grade(llmProjectReference, "llm-project-v1", "llm-project-challenge")).passed).toBe(true);
});
it.each([
  ["no retry", llmProjectReference.replace("while attempts < 3:", "while attempts < 1:")],
  ["ignores validation", llmProjectReference.replace(
    '        verdict = validate_text(raw)\n        if verdict["ok"]:\n            return {"ok": True, "data": verdict["data"], "errors": [], "attempts": attempts}\n        last_errors = verdict["errors"]',
    '        if type(raw) is str:\n            return {"ok": True, "data": None, "errors": [], "attempts": attempts}\n        last_errors = ["invalid_json"]')],
  ["wrong max attempts", llmProjectReference.replace("while attempts < 3:", "while attempts < 5:")],
])("rejects llm project bug: %s", async (_label, source) => {
  expect((await grade(source, "llm-project-v1", "llm-project-challenge")).passed).toBe(false);
});

const recoveryProjectReference = `import json
import re

ERROR_RE = re.compile(r"^([A-Za-z_]\\w*(?:Error|Exception))\\s*:")

def error_name(text):
    if type(text) is not str:
        return None
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if line.strip() == "Traceback (most recent call last):"]
    block = lines[starts[-1] + 1:] if starts else []
    name = None
    for line in block:
        match = ERROR_RE.match(line.strip())
        if match:
            name = match.group(1)
    return name

def solve(path):
    counts = {}
    try:
        with open(path) as handle:
            lines = handle.readlines()
    except (OSError, TypeError):
        return {}
    for line in lines:
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except Exception:
            counts["unparsed"] = counts.get("unparsed", 0) + 1
            continue
        name = error_name(record.get("traceback")) if type(record) is dict else None
        if name is None:
            counts["unparsed"] = counts.get("unparsed", 0) + 1
        else:
            counts[name] = counts.get(name, 0) + 1
    return counts
`;
it("grades the crash-log scanner project", async () => {
  expect((await grade(recoveryProjectReference, "recovery-project-v1", "recovery-project-challenge")).passed).toBe(true);
});
it.each([
  ["no with block", recoveryProjectReference.replace("        with open(path) as handle:\n            lines = handle.readlines()", "        handle = open(path)\n        lines = handle.readlines()\n        handle.close()")],
  ["raises on missing file", recoveryProjectReference.replace("    try:\n        with open(path) as handle:\n            lines = handle.readlines()\n    except (OSError, TypeError):\n        return {}", "    with open(path) as handle:\n        lines = handle.readlines()")],
  ["counts unparsed as errors", recoveryProjectReference.replace('            counts["unparsed"] = counts.get("unparsed", 0) + 1\n            continue\n        name = error_name(record.get("traceback")) if type(record) is dict else None', '            continue\n        name = error_name(record.get("traceback")) if type(record) is dict else None')],
])("rejects recovery project bug: %s", async (_label, source) => {
  expect((await grade(source, "recovery-project-v1", "recovery-project-challenge")).passed).toBe(false);
});

const validationProjectReference = `def check_username(value):
    if type(value) is not str:
        return "not-a-string"
    if not 3 <= len(value.strip()) <= 20:
        return "bad-length"
    return None

def check_email(value):
    if type(value) is not str:
        return "not-a-string"
    text = value.strip()
    if text.count("@") != 1:
        return "bad-format"
    local, domain = text.split("@")
    if not local or not domain or any(ch.isspace() for ch in text):
        return "bad-format"
    return None

def check_age(value):
    if type(value) is bool or type(value) is not int:
        return "not-an-int"
    if not 13 <= value <= 120:
        return "out-of-range"
    return None

def solve(records):
    if type(records) is not list:
        return {"valid": [], "errors": []}
    valid = []
    errors = []
    for index, raw in enumerate(records):
        if type(raw) is not dict:
            errors.append({"index": index, "reasons": ["not-a-record"]})
            continue
        reasons = []
        username_reason = check_username(raw.get("username"))
        if username_reason:
            reasons.append("username:" + username_reason)
        email_reason = check_email(raw.get("email"))
        if email_reason:
            reasons.append("email:" + email_reason)
        age_reason = check_age(raw.get("age"))
        if age_reason:
            reasons.append("age:" + age_reason)
        if reasons:
            errors.append({"index": index, "reasons": reasons})
        else:
            valid.append({"username": raw["username"].strip(), "email": raw["email"].strip(), "age": raw["age"]})
    return {"valid": valid, "errors": errors}
`;
it("grades the signup validation project", async () => {
  expect((await grade(validationProjectReference, "validation-project-v1", "validation-project-challenge")).passed).toBe(true);
});
it.each([
  ["missing helpers", validationProjectReference.replace(/def check_\w+\(value\):\n(?:    .*\n)+?\n/g, "")],
  ["stops at first bad field", validationProjectReference.replace("        if reasons:\n            errors.append({\"index\": index, \"reasons\": reasons})", "        if reasons:\n            errors.append({\"index\": index, \"reasons\": reasons[:1]})")],
  ["accepts bool age", validationProjectReference.replace("    if type(value) is bool or type(value) is not int:", "    if not isinstance(value, int):")],
])("rejects validation project bug: %s", async (_label, source) => {
  expect((await grade(source, "validation-project-v1", "validation-project-challenge")).passed).toBe(false);
});

const transformProjectReference = `from decimal import Decimal, InvalidOperation

def parse_price(text):
    if type(text) is not str:
        return None
    try:
        value = Decimal(text)
    except InvalidOperation:
        return None
    if not value.is_finite() or value < 0:
        return None
    try:
        if value.quantize(Decimal("0.01")) != value:
            return None
    except InvalidOperation:
        return None
    return value

def solve(catalog):
    if type(catalog) is not list:
        return []
    result = []
    for category in catalog:
        if type(category) is not dict:
            continue
        cat_name = category.get("category")
        if type(cat_name) is not str or not cat_name.strip():
            continue
        products = category.get("products")
        if type(products) is not list:
            continue
        for product in products:
            if type(product) is not dict:
                continue
            prod_name = product.get("name")
            if type(prod_name) is not str or not prod_name.strip():
                continue
            variants = product.get("variants")
            if type(variants) is not list:
                continue
            items = [v for v in variants
                     if type(v) is dict
                     and type(v.get("sku")) is str and v.get("sku").strip()
                     and parse_price(v.get("price")) is not None]
            for variant in items:
                price = parse_price(variant.get("price"))
                result.append({"category": cat_name.strip(), "product": prod_name.strip(),
                               "sku": variant["sku"].strip(), "price": format(price, ".2f")})
    return result
`;
it("grades the catalog transformer project", async () => {
  expect((await grade(transformProjectReference, "transform-project-v1", "transform-project-challenge")).passed).toBe(true);
});
it.each([
  ["no comprehension", transformProjectReference.replace("            items = [v for v in variants\n                     if type(v) is dict\n                     and type(v.get(\"sku\")) is str and v.get(\"sku\").strip()\n                     and parse_price(v.get(\"price\")) is not None]", "            items = []\n            for v in variants:\n                if type(v) is dict and type(v.get(\"sku\")) is str and v.get(\"sku\").strip() and parse_price(v.get(\"price\")) is not None:\n                    items.append(v)")],
  ["rounds fractional cents", transformProjectReference.replace("    try:\n        if value.quantize(Decimal(\"0.01\")) != value:\n            return None\n    except InvalidOperation:\n        return None", "    value = value.quantize(Decimal(\"0.01\"))")],
  ["reuses input dicts", transformProjectReference.replace('                result.append({"category": cat_name.strip(), "product": prod_name.strip(),\n                               "sku": variant["sku"].strip(), "price": format(price, ".2f")})', '                variant["price"] = format(price, ".2f")\n                result.append(variant)')],
])("rejects transform project bug: %s", async (_label, source) => {
  expect((await grade(source, "transform-project-v1", "transform-project-challenge")).passed).toBe(false);
});
