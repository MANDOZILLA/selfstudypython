import { paymentsCsv } from "../public/grading/catalog.js";

const paymentsExercise = {
  id: "messy-csv-challenge", graderId: "payments-csv-v1",
  starterFiles: { "main.py": "import csv\nimport io\nfrom decimal import Decimal, InvalidOperation\n\ndef solve(csv_text: str):\n    # Parse, validate, and normalize the CSV rows.\n    return []\n" },
  visibleRequirements: [
    "Define solve(csv_text: str). Use csv.DictReader to parse CSV text and Decimal to validate money; imports, comments, and strings alone do not meet these concept checks.",
    "The header must be exactly id,amount,currency in that order. Return [] for empty, header-only, or unexpected-header input.",
    "Return an ordered list of dictionaries with exactly three string fields: id, amount, currency. Trim every input value; uppercase currency. Keep IDs case-sensitive.",
    "Accept only USD, EUR, or GBP and a nonempty ID. Skip rows with missing or extra columns, blank/invalid amounts, NaN, infinity, negative values, or fractional cents. Decimal-compatible numeric text is accepted; amounts must fit Decimal's default precision when quantized to cents.",
    "Format valid amounts as nonnegative strings with exactly two decimal places (0 and -0.00 become 0.00). Do not round fractional cents into validity.",
    "Keep the first valid occurrence of each trimmed ID and preserve CSV order. Invalid rows do not reserve IDs. Handle CSV quoting, including commas inside quoted IDs.",
  ],
  hints: ["Use csv.DictReader(io.StringIO(csv_text)); inspect reader.fieldnames before processing rows.", "Reject extra columns (the None key), missing values, blank IDs, and unsupported currencies.", "Parse Decimal inside try/except InvalidOperation. Require is_finite(), amount >= 0, and equality with quantize(Decimal('0.01')).", "Track IDs only after validation; append exactly id, amount, currency, formatting the amount to two decimals."],
};

const skillSeeds: [string, string, string[]][] = [
  ["python-debugging", "Debugging & stack traces", []], ["python-functions", "Functions, scope & type hints", []],
  ["data-structures", "Data structures & transformations", ["python-functions"]], ["csv-cleaning", "CSV cleaning", ["data-structures"]],
  ["json-validation", "JSON validation", ["data-structures"]], ["pandas-quality", "Pandas data quality", ["csv-cleaning"]],
  ["http-apis", "HTTP & API resilience", ["json-validation"]], ["sqlite-queries", "SQLite queries", ["data-structures"]],
  ["financial-data", "Financial data correctness", ["csv-cleaning"]], ["llm-reliability", "Reliable LLM outputs", ["json-validation"]],
];
export const skills = skillSeeds.map(([id, title, prerequisites]) => ({ id, title, prerequisites }));

const lessonSeeds = [
  ["refresh-debug", "Python refresh: debug the failure, not the symptom", "python-debugging", "Repair a broken reconciliation script and explain its traceback."],
  ["functions-scope", "Functions that survive real inputs", "python-functions", "Turn a fragile helper into a typed, testable function."],
  ["structure-transform", "Transform records without losing meaning", "data-structures", "Normalize nested transaction records with lists and dictionaries."],
  ["messy-csv", "Clean a corrupted payments CSV", "csv-cleaning", "Parse malformed rows and return a clean, auditable dataset."],
  ["json-contracts", "Treat JSON as an unreliable contract", "json-validation", "Validate missing fields and produce safe normalized records."],
  ["pandas-quality-lab", "Pandas as a data-quality tool", "pandas-quality", "Find missing values, duplicates, and suspicious categories."],
  ["api-resilience", "API parsing with failure in mind", "http-apis", "Handle fixture responses, pagination, and retryable failures."],
  ["sqlite-ledger", "Query a transaction ledger", "sqlite-queries", "Write aggregate queries that reconcile a SQLite ledger."],
  ["money-anomalies", "Money and anomaly signals", "financial-data", "Use Decimal and robust rules to flag suspicious transactions."],
  ["structured-llm", "Validate an LLM before trusting it", "llm-reliability", "Validate structured classifications against a deterministic schema."],
] as const;

export const lessons = lessonSeeds.map(([id, title, skillId, project]) => ({
  id, title, skillId, estimatedMinutes: 45,
  objectives: id === "messy-csv" ? ["Parse quoted CSV fields and reject invalid payment rows.", "Return exact decimal amounts, deduplicate valid IDs, and preserve row order."] : ["Write code that handles an expected happy path.", "Explain and handle a realistic failure mode."],
  explanation: id === "messy-csv" ? "Implement solve(csv_text: str) to turn a corrupted payments export into normalized rows. Every listed requirement is checked; running without an exception is not enough to pass." : "Production work begins by making assumptions explicit, writing a small correct path, then checking the data and errors that will break it.",
  examples: id === "messy-csv" ? [paymentsCsv, "Expected: [{'id': 'pay_101', 'amount': '12.00', 'currency': 'USD'}, {'id': 'pay_103', 'amount': '0.10', 'currency': 'EUR'}]"] : ["Start with one representative record and state its shape.", "Add a malformed or missing field, then decide what safe behavior means."],
  exercise: id === "messy-csv" ? paymentsExercise : {
    id: `${id}-challenge`, graderId: `${id}-unavailable`, starterFiles: { "main.py": "def solve(records):\n    # write your solution\n    return records\n" },
    visibleRequirements: ["Keep the function named solve.", "Return a value rather than only printing it."],
    hints: ["Name the input shape before writing the loop.", "Check the branch that handles missing or invalid data.", "Pseudocode: validate → transform valid items → return collected results.", "Start with: result = [] and append only safe normalized values."],
  }, dailyProject: project,
}));

export const projects = [
  ["project-messy-csv", "Repair and analyze a messy CSV dataset", ["csv-cleaning", "python-debugging"]],
  ["project-api-normalizer", "Normalize a public JSON API response", ["json-validation", "http-apis"]],
  ["project-transaction-anomalies", "Flag anomalies in fake financial transactions", ["financial-data", "sqlite-queries"]],
  ["project-llm-classifier", "Build a validated LLM classification tool", ["llm-reliability", "json-validation"]],
].map(([id, title, skillIds]) => ({ id, title, skillIds, objective: "Deliver a small, testable engineering artifact with clear failure handling." }));

export const assessments = [{ id: "core-evidence-checkpoint", title: "Core data reliability checkpoint", skillIds: ["csv-cleaning", "json-validation", "http-apis"] }];
