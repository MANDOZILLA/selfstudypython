/**
 * Portfolio project definitions.
 *
 * Four stable, GitHub-ready portfolio projects. Each project is a fixed set of
 * components; every component is produced by one tagged mission build task.
 * Definitions are frozen at export time into immutable completion snapshots
 * (see lib/portfolio.ts), so later curriculum edits can never rewrite a
 * learner's exported evidence.
 */

export interface PortfolioProjectComponent {
  /** Mission build task id that produces this component. */
  taskId: string;
  /** Exercise and grader ids of the task variant that produces this component. */
  exerciseId: string;
  graderId: string;
  /** Short component title used in the portfolio and the export. */
  title: string;
  /** What the finished component does, in one paragraph. */
  objective: string;
  /** Skill ids demonstrated by the component (curriculum/skills.ts). */
  skillIds: string[];
  /** Directory name inside the exported zip (sanitized). */
  directory: string;
  /** Exported unittest file name. */
  testFileName: string;
  /** Exported unittest file content. Tests the learner's main.py. */
  testFileContent: string;
  /** Fixture files shipped with the component (name -> content). */
  fixtureFiles: Record<string, string>;
}

export interface PortfolioProjectDefinition {
  id: string;
  version: string;
  title: string;
  objective: string;
  components: PortfolioProjectComponent[];
}

const CSV_REPAIR_TEST = `"""Exported test suite for the CSV payment repair component."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import solve

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "sample-payments.csv")


class TestCsvRepair(unittest.TestCase):
    def test_repairs_and_drops_bad_rows(self):
        with open(FIXTURE, encoding="utf-8") as handle:
            rows = solve(handle.read())
        self.assertEqual(rows, [
            {"id": "pay_101", "amount": "12.00", "currency": "USD"},
            {"id": "pay_103", "amount": "0.10", "currency": "EUR"},
        ])

    def test_empty_input_returns_empty_list(self):
        self.assertEqual(solve(""), [])

    def test_wrong_header_rejected(self):
        self.assertEqual(solve("id,wrong\\npay_1,1.00,USD\\n"), [])


if __name__ == "__main__":
    unittest.main()
`;

const CRASH_LOG_TEST = `"""Exported test suite for the crash-log scanner component."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import solve

LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "crash.log")


class TestCrashLogScanner(unittest.TestCase):
    def test_counts_named_errors_and_unparsed_lines(self):
        self.assertEqual(solve(LOG), {"ZeroDivisionError": 1, "unparsed": 2})

    def test_missing_file_returns_empty(self):
        self.assertEqual(solve("no-such-file.log"), {})

    def test_none_returns_empty(self):
        self.assertEqual(solve(None), {})


if __name__ == "__main__":
    unittest.main()
`;

const DATA_QUALITY_TEST = `"""Exported test suite for the pandas data-quality component."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import solve

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "sales.csv")


class TestDataQuality(unittest.TestCase):
    def test_cleaning_summary(self):
        with open(FIXTURE, encoding="utf-8") as handle:
            result = solve(handle.read())
        self.assertEqual(result["rows_in"], 4)
        self.assertEqual(result["rows_out"], 3)
        self.assertEqual(result["dropped"], 1)
        self.assertEqual(result["fill_report"], {"amount": "median", "region": "unknown"})
        self.assertEqual(result["by_region"], [
            {"region": "west", "orders": 1, "total": 10.0},
            {"region": "east", "orders": 1, "total": 7.5},
            {"region": "unknown", "orders": 1, "total": 5.0},
        ])

    def test_empty_input(self):
        self.assertEqual(solve(""), {
            "rows_in": 0, "rows_out": 0, "dropped": 0,
            "fill_report": {"amount": "median", "region": "unknown"}, "by_region": [],
        })


if __name__ == "__main__":
    unittest.main()
`;

const MONEY_RECONCILIATION_TEST = `"""Exported test suite for the money reconciliation component."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import solve

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "ledger.csv")


class TestMoneyReconciliation(unittest.TestCase):
    def test_flags_duplicates_and_bad_rows(self):
        with open(FIXTURE, encoding="utf-8") as handle:
            result = solve(handle.read())
        self.assertEqual(result, {"rows": 4, "flagged": ["a", "c"], "net": "6.00"})

    def test_empty_input(self):
        self.assertEqual(solve(""), {"rows": 0, "flagged": [], "net": "0.00"})


if __name__ == "__main__":
    unittest.main()
`;

const JSON_NORMALIZATION_TEST = `"""Exported test suite for the JSON normalization component."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import solve

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "payments.json")


class TestJsonNormalization(unittest.TestCase):
    def test_normalizes_records(self):
        with open(FIXTURE, encoding="utf-8") as handle:
            result = solve(handle.read())
        self.assertEqual(result, [{"id": "p1", "amount": "0.10", "currency": "EUR"}])

    def test_invalid_json_rejected(self):
        self.assertEqual(solve("not json"), [])

    def test_wrong_envelope_rejected(self):
        self.assertEqual(solve("[1,2,3]"), [])


if __name__ == "__main__":
    unittest.main()
`;

const HTTP_PAGINATION_TEST = `"""Exported test suite for the HTTP pagination collector component."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import solve

PAGES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "pages.json")


def load_pages():
    with open(PAGES_PATH, encoding="utf-8") as handle:
        return json.load(handle)["pages"]


def make_transport(pages, calls):
    def transport(method, url):
        calls.append((method, url))
        page = pages.get(url)
        if page is None:
            return (404, {}, "")
        return (200, {}, json.dumps({"items": page["items"], "next": page["next"]}))
    return transport


class TestHttpPagination(unittest.TestCase):
    def test_collects_all_pages(self):
        calls = []
        messages = []
        result = solve(make_transport(load_pages(), calls), "/p1", messages.append)
        self.assertEqual(result, {"items": [1, 2], "pages": 2, "ok": True})
        self.assertEqual(calls, [("GET", "/p1"), ("GET", "/p2")])

    def test_missing_transport_fails_closed(self):
        self.assertEqual(solve(None, "/p1", lambda message: None), {"items": [], "pages": 0, "ok": False})


if __name__ == "__main__":
    unittest.main()
`;

const LLM_GUARDRAILS_TEST = `"""Exported test suite for the LLM output guardrails component."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import solve

RESPONSES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "model-responses.json")


class TestLlmGuardrails(unittest.TestCase):
    def test_recovers_after_bad_attempt(self):
        with open(RESPONSES_PATH, encoding="utf-8") as handle:
            script = json.load(handle)
        calls = {"count": 0}

        def model(prompt, attempts):
            response = script[calls["count"]]
            calls["count"] += 1
            return response

        result = solve(model, "Extract the user profile.")
        self.assertEqual(result, {
            "ok": True,
            "data": {"name": "Ada", "age": 36, "email": "a@x.com"},
            "errors": [],
            "attempts": 2,
        })

    def test_bad_input_fails_closed(self):
        self.assertEqual(solve(None, "hi"), {"ok": False, "data": None, "errors": ["bad_input"], "attempts": 0})


if __name__ == "__main__":
    unittest.main()
`;

export const PORTFOLIO_PROJECT_DEFINITIONS: PortfolioProjectDefinition[] = [
  {
    id: "portfolio-data-pipeline",
    version: "1.0.0",
    title: "Payments data pipeline",
    objective:
      "A small, defensive data pipeline: repair messy payment CSVs, scan crash logs for error signatures, and clean sales data with pandas.",
    components: [
      {
        taskId: "csv-project",
        exerciseId: "messy-csv-challenge",
        graderId: "payments-csv-v1",
        title: "CSV payment repair",
        objective:
          "Parse a messy payments CSV, normalize whitespace and currency codes, drop rows with missing amounts or bad headers, and return clean payment records.",
        skillIds: ["python-functions", "csv-cleaning", "data-structures"],
        directory: "csv-repair",
        testFileName: "test_csv_repair.py",
        testFileContent: CSV_REPAIR_TEST,
        fixtureFiles: {
          "sample-payments.csv":
            "id,amount,currency\n pay_101 ,12.00, usd \npay_102,,USD\npay_103,0.10,EUR\npay_101,90.00,USD\n",
        },
      },
      {
        taskId: "crash-log-scanner",
        exerciseId: "recovery-project-challenge",
        graderId: "recovery-project-v1",
        title: "Crash-log scanner",
        objective:
          "Read a log file of JSON crash records, extract the named Python exception from each traceback, and count occurrences while tolerating unparsable lines.",
        skillIds: ["python-functions", "python-exceptions", "file-io"],
        directory: "crash-log-scanner",
        testFileName: "test_crash_log_scanner.py",
        testFileContent: CRASH_LOG_TEST,
        fixtureFiles: {
          "crash.log":
            '{"traceback": "Traceback (most recent call last):\\n  File \\"a.py\\", line 1, in <module>\\nZeroDivisionError: division by zero"}\nnot json\n{"traceback": 42}\n',
        },
      },
      {
        taskId: "pandas-quality-project",
        exerciseId: "pandas-quality-project",
        graderId: "pandas-project-v1",
        title: "Pandas data quality",
        objective:
          "Load sales data with pandas, drop rows missing an id, fill missing regions and amounts with documented strategies, and aggregate order totals by region.",
        skillIds: ["pandas-data-quality", "csv-cleaning", "data-structures"],
        directory: "data-quality",
        testFileName: "test_data_quality.py",
        testFileContent: DATA_QUALITY_TEST,
        fixtureFiles: {
          "sales.csv": "id,region,amount\na,west,10.00\nb,,5.00\n,west,7.00\nc,east,\n",
        },
      },
    ],
  },
  {
    id: "portfolio-api-normalization",
    version: "1.0.0",
    title: "API response normalization",
    objective:
      "Turn unreliable API output into clean data: normalize nested payment JSON and collect paginated HTTP results with bounded retries.",
    components: [
      {
        taskId: "json-project",
        exerciseId: "api-normalization-challenge",
        graderId: "api-normalization-v1",
        title: "Payment JSON normalization",
        objective:
          "Validate a JSON payload's payment envelope, normalize each record's id, amount, and currency, and reject malformed or wrongly-shaped input.",
        skillIds: ["json-validation", "data-structures"],
        directory: "json-normalization",
        testFileName: "test_json_normalization.py",
        testFileContent: JSON_NORMALIZATION_TEST,
        fixtureFiles: {
          "payments.json":
            '{"payments":[{"id":" p1 ","money":{"amount":"0.10","currency":"eur"}}, {"id":"p2","money":null}]}',
        },
      },
      {
        taskId: "http-pagination-project",
        exerciseId: "http-project-challenge",
        graderId: "http-project-v1",
        title: "HTTP pagination collector",
        objective:
          "Walk a paginated HTTP API with bounded retries, parse each page's items, and fail closed on transport errors or exhausted retries.",
        skillIds: ["http-reliability", "json-validation", "python-exceptions"],
        directory: "http-pagination",
        testFileName: "test_http_pagination.py",
        testFileContent: HTTP_PAGINATION_TEST,
        fixtureFiles: {
          "pages.json":
            '{"pages": {"/p1": {"items": [1], "next": "/p2"}, "/p2": {"items": [2], "next": null}}}',
        },
      },
    ],
  },
  {
    id: "portfolio-money-reconciliation",
    version: "1.0.0",
    title: "Money reconciliation and anomaly detection",
    objective:
      "Reconcile a money ledger with exact decimal arithmetic: flag duplicate ids and malformed rows, and compute the net balance.",
    components: [
      {
        taskId: "money-csv-project",
        exerciseId: "money-project-challenge",
        graderId: "money-project-v1",
        title: "Ledger reconciliation",
        objective:
          "Parse a credit/debit ledger with Decimal arithmetic, flag duplicate ids and malformed amounts, and report the exact net balance.",
        skillIds: ["financial-data", "csv-cleaning", "python-exceptions"],
        directory: "money-reconciliation",
        testFileName: "test_money_reconciliation.py",
        testFileContent: MONEY_RECONCILIATION_TEST,
        fixtureFiles: {
          "ledger.csv": "id,amount,type\na,10.00,credit\nb,4.00,debit\na,1.00,credit\nc,x,debit\n",
        },
      },
    ],
  },
  {
    id: "portfolio-llm-guardrails",
    version: "1.0.0",
    title: "Deterministic LLM output guardrails",
    objective:
      "Keep an LLM pipeline deterministic and safe: extract JSON from model output, validate it against a strict schema, and retry with error context.",
    components: [
      {
        taskId: "llm-pipeline-project",
        exerciseId: "llm-project-challenge",
        graderId: "llm-project-v1",
        title: "LLM extraction guardrails",
        objective:
          "Call a model function, extract embedded JSON from its raw output, validate the profile schema strictly, and retry with a bounded budget on failure.",
        skillIds: ["llm-output-validation", "json-validation", "python-exceptions"],
        directory: "llm-guardrails",
        testFileName: "test_llm_guardrails.py",
        testFileContent: LLM_GUARDRAILS_TEST,
        fixtureFiles: {
          "model-responses.json": '["oops", "{\\"name\\": \\"Ada\\", \\"age\\": 36, \\"email\\": \\"a@x.com\\"}"]',
        },
      },
    ],
  },
];

export function getPortfolioProject(id: string): PortfolioProjectDefinition | undefined {
  return PORTFOLIO_PROJECT_DEFINITIONS.find((p) => p.id === id);
}

export function findPortfolioComponent(
  taskId: string,
): { project: PortfolioProjectDefinition; component: PortfolioProjectComponent } | undefined {
  for (const project of PORTFOLIO_PROJECT_DEFINITIONS) {
    const component = project.components.find((c) => c.taskId === taskId);
    if (component) return { project, component };
  }
  return undefined;
}
