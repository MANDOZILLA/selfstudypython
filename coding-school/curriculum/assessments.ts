/**
 * Checkpoint assessments: three checkpoints (foundations, data, applied),
 * each with five components — read, debug, scratch, project, explain.
 *
 * Grouping rationale: each checkpoint covers the missions of one curriculum
 * group, so the assessment re-tests the same skills in new scenarios (new
 * code, new data) rather than repeating mission content. Identical tasks
 * never count twice toward mastery; the scenarios here are deliberately
 * different from the mission scenarios.
 *
 * Solutions are never stored here. Task definitions carry the prompt, the
 * rubric criterion ids, progressive hints, and the grader reference — the
 * reference solution lives only in the test suite (as the RED/GREEN
 * oracle), never in learner-facing state.
 */

export type AssessmentTaskKind = "read" | "debug" | "scratch" | "project" | "explain";

export interface AssessmentTask {
  id: string;
  title: string;
  kind: AssessmentTaskKind;
  /** Cross-cutting skill this task evidences (shared across checkpoints). */
  skillId: string;
  /** Learner-facing prompt. Never contains a solution. */
  prompt: string;
  /** Rubric criterion ids, in grading order. */
  rubric: string[];
  /** Python grader id for debug/scratch/project tasks. */
  graderId?: string;
  /** Written exercise id for read/explain tasks. */
  exerciseId?: string;
  /** Progressive hints, weakest first. Guidance only, never a full solution. */
  hints: string[];
}

export interface Assessment {
  id: string;
  title: string;
  description: string;
  tasks: AssessmentTask[];
}

const FOUNDATIONS_TASKS: AssessmentTask[] = [
  {
    id: "foundations-read-task",
    title: "Read: the log counter",
    kind: "read",
    skillId: "code-reading",
    prompt:
      "Read this function, then answer the three questions below in your own words.\n\n" +
      "def count_levels(path):\n" +
      "    counts = {}\n" +
      "    with open(path) as handle:\n" +
      "        for line in handle:\n" +
      "            line = line.strip()\n" +
      "            if not line:\n" +
      "                continue\n" +
      '            if ":" not in line:\n' +
      "                continue\n" +
      '            level, _ = line.split(":", 1)\n' +
      "            level = level.strip().lower()\n" +
      "            counts[level] = counts.get(level, 0) + 1\n" +
      "    return counts\n\n" +
      "The file app.log contains:\n" +
      "    INFO: boot complete\n" +
      "    broken line without a colon\n" +
      "    ERROR: disk full\n" +
      "    WARN: retrying\n" +
      "    ERROR: disk full\n\n" +
      '1. What happens to the line "broken line without a colon"? Trace exactly which statements run for it.\n' +
      '2. What is the exact value of counts["disk full"] after the run?\n' +
      "3. In one sentence, state the function's contract: what does it count?",
    rubric: ["read-trace", "read-result", "read-contract"],
    exerciseId: "foundations-read-challenge",
    hints: [
      "Trace the loop line by line for the broken line — which `if` catches it?",
      "Count how many times each distinct message appears.",
      "The contract is about messages, not lines.",
    ],
  },
  {
    id: "foundations-debug-task",
    title: "Debug: the age averager",
    kind: "debug",
    skillId: "debugging",
    prompt:
      "This function is supposed to return the average of valid ages, but it crashes on real data. " +
      "Fix it so that:\n" +
      "- non-dict rows and rows with missing or non-string names are skipped\n" +
      "- ages that are not finite numbers are skipped\n" +
      "- it returns 0.0 when no valid ages remain\n" +
      "- it never raises\n\n" +
      "def summarize_ages(rows):\n" +
      "    total = 0\n" +
      "    count = 0\n" +
      "    for row in rows:\n" +
      '        total += row["age"]\n' +
      "        count += 1\n" +
      "    return total / count",
    rubric: ["concept-except", "sample", "empty", "invalid", "types", "shape"],
    graderId: "foundations-debug-v1",
    hints: [
      "What happens when row is not a dict?",
      'row["age"] raises KeyError when the key is missing — how do you skip instead?',
      "What should happen when count is 0?",
    ],
  },
  {
    id: "foundations-scratch-task",
    title: "Scratch: normalize names",
    kind: "scratch",
    skillId: "scratch-coding",
    prompt:
      "Write a function normalize_names(names) that:\n" +
      "- takes a list of raw name strings\n" +
      "- strips surrounding whitespace from each\n" +
      '- title-cases each name ("aLIcE" -> "Alice")\n' +
      "- drops empty results\n" +
      "- returns the cleaned list in order, with duplicates removed (first occurrence wins)\n" +
      "- returns [] for an empty input, and never raises on a list input",
    rubric: ["sample", "empty", "invalid", "shape"],
    graderId: "foundations-scratch-v1",
    hints: [
      "str.strip() and str.title() do the cleaning.",
      "How do you remember which names you already kept?",
      "An empty string is falsy — use that to drop empties.",
    ],
  },
  {
    id: "foundations-project-task",
    title: "Project: summarize a log file",
    kind: "project",
    skillId: "project-building",
    prompt:
      "Write a function summarize_log_file(path) that:\n" +
      "- opens the file at path with a `with` block (it must close the file itself)\n" +
      "- counts one entry per non-empty line; the level is the text before the first colon, lowercased and stripped\n" +
      "- counts lines without a colon as malformed (they still count toward the total)\n" +
      '- returns {"levels": {level: count}, "malformed": n, "total": m}\n' +
      '- returns {"levels": {}, "malformed": 0, "total": 0} when the file does not exist — never raises',
    rubric: ["concept-with", "sample", "empty", "malformed", "case", "shape", "missing-file"],
    graderId: "foundations-project-v1",
    hints: [
      "A `with open(path) as handle:` block closes the file for you.",
      "Split each line on the first colon only.",
      "Check whether the path exists before opening it.",
    ],
  },
  {
    id: "foundations-explain-task",
    title: "Explain: the crashing handler",
    kind: "explain",
    skillId: "design-explanation",
    prompt:
      "1. The block below is supposed to skip bad ages, but it still crashes on real data. Explain why.\n" +
      "       try:\n" +
      "           age = int(raw)\n" +
      "       except KeyError:\n" +
      "           continue\n" +
      "2. Name one edge case a fixed version must handle, and explain why it matters.",
    rubric: ["explain-except", "explain-edge"],
    exerciseId: "foundations-explain-challenge",
    hints: [
      "What does int() raise when raw is 'abc'?",
      "Think about empty input, duplicates, or missing values.",
    ],
  },
];

const DATA_TASKS: AssessmentTask[] = [
  {
    id: "data-read-task",
    title: "Read: the CSV loader",
    kind: "read",
    skillId: "code-reading",
    prompt:
      "Read this function, then answer in your own words.\n\n" +
      "def load(text):\n" +
      "    rows = []\n" +
      '    for line in text.strip().split("\\n")[1:]:\n' +
      '        parts = line.split(",")\n' +
      "        if len(parts) != 2:\n" +
      "            continue\n" +
      "        ident, amount = parts[0].strip(), parts[1].strip()\n" +
      "        try:\n" +
      "            value = float(amount)\n" +
      "        except ValueError:\n" +
      "            continue\n" +
      "        rows.append((ident, value))\n" +
      "    return rows\n\n" +
      "1. What does load('id,amount\\n7,7\\n8,eight\\n9,9\\n') return, exactly?\n" +
      "2. What happens when load is called with None instead of a string? Name the exception.",
    rubric: ["read-value", "read-envelope"],
    exerciseId: "data-read-challenge",
    hints: [
      "Trace each data row: which ones survive the try/except?",
      "None has no .strip() — what does Python raise?",
    ],
  },
  {
    id: "data-debug-task",
    title: "Debug: the settlement parser",
    kind: "debug",
    skillId: "debugging",
    prompt:
      "This CSV settlement parser crashes on real exports. Fix parse_settlements(csv_text) so it:\n" +
      "- reads the CSV with csv.DictReader (never split(\",\") by hand)\n" +
      "- parses amounts with Decimal from the raw string (never float)\n" +
      "- skips rows with missing/invalid ids or unparseable amounts\n" +
      '- returns a list of {"id": ..., "amount": Decimal(...)} dicts, never raising\n\n' +
      "import csv\n" +
      "from decimal import Decimal\n\n" +
      "def parse_settlements(csv_text):\n" +
      "    rows = []\n" +
      '    for line in csv_text.strip().split("\\n")[1:]:\n' +
      '        ident, amount = line.split(",")\n' +
      '        rows.append({"id": ident, "amount": float(amount)})\n' +
      "    return rows",
    rubric: ["concept-csv", "concept-decimal", "sample", "empty", "header", "invalid", "shape"],
    graderId: "data-debug-v1",
    hints: [
      "csv.DictReader maps columns by header name.",
      "Decimal(str_value) keeps cents exact; float does not.",
      "Wrap the per-row parsing in try/except and skip bad rows.",
    ],
  },
  {
    id: "data-scratch-task",
    title: "Scratch: totals by currency",
    kind: "scratch",
    skillId: "scratch-coding",
    prompt:
      "Write total_by_currency(records) that:\n" +
      '- takes a list of {"id": str, "amount": str, "currency": str} dicts\n' +
      "- sums amounts per currency using Decimal (parse from the raw strings)\n" +
      "- skips rows with missing/invalid ids, unparseable amounts, or blank currencies\n" +
      '- returns {currency: "12.34"} with amounts formatted to exactly 2 decimals\n' +
      "- returns {} for empty input and never raises",
    rubric: ["sample", "empty", "precision", "invalid", "shape"],
    graderId: "data-scratch-v1",
    hints: [
      "Decimal('0.1') + Decimal('0.2') is exact; 0.1 + 0.2 is not.",
      "format(total, '.2f') gives exactly two decimals.",
      "Skip, don't crash, on bad rows.",
    ],
  },
  {
    id: "data-project-task",
    title: "Project: reconcile a manifest",
    kind: "project",
    skillId: "project-building",
    prompt:
      "Write reconcile(manifest, confirmed) that:\n" +
      "- parses manifest, a CSV string with an id,status header\n" +
      "- parses confirmed, a JSON string that must be a list of id strings\n" +
      '- returns {"matched": [...], "missing": [...], "unexpected": [...]} where\n' +
      "    matched = confirmed ids present in the manifest,\n" +
      "    missing = confirmed ids absent from the manifest,\n" +
      "    unexpected = manifest ids not in the confirmed list\n" +
      "- treats blank ids and unknown statuses as corrupt rows (skipped)\n" +
      '- returns {"matched": [], "missing": [], "unexpected": []} for bad JSON or a non-list envelope — never raises',
    rubric: ["concept-json", "sample", "empty", "envelope", "invalid", "duplicates", "shape"],
    graderId: "data-project-v1",
    hints: [
      "json.loads can raise — catch it and return the empty result.",
      "Build a set of manifest ids first, then classify each confirmed id.",
      "A JSON object or string is not a valid envelope; only a list counts.",
    ],
  },
  {
    id: "data-explain-task",
    title: "Explain: headers and corruption",
    kind: "explain",
    skillId: "design-explanation",
    prompt:
      "1. Why does csv.DictReader key columns by header name instead of position? " +
      "Describe a concrete export change that breaks position-based parsing but not DictReader.\n" +
      "2. Name one way a real CSV export can be corrupt, and how your parser should guard against it.",
    rubric: ["explain-header", "explain-corruption"],
    exerciseId: "data-explain-challenge",
    hints: [
      "What happens when the exporter reorders two columns?",
      "Think about ragged rows, blank lines, or stray commas.",
    ],
  },
];

const APPLIED_TASKS: AssessmentTask[] = [
  {
    id: "applied-read-task",
    title: "Read: the retry loop",
    kind: "read",
    skillId: "code-reading",
    prompt:
      "Read this function, then answer in your own words.\n\n" +
      "def fetch_with_retry(get, url, retries=3):\n" +
      "    for attempt in range(retries):\n" +
      "        response = get(url)\n" +
      "        if response.status < 500:\n" +
      "            return response\n" +
      "        if attempt < retries - 1:\n" +
      "            sleep(2 ** attempt)\n" +
      "    return None\n\n" +
      "1. What does fetch_with_retry return when every attempt gets a 500? How many requests were made?\n" +
      "2. What does it return for a 400 on the first attempt? Is the 400 retried?",
    rubric: ["read-exhaust", "read-client-error"],
    exerciseId: "applied-read-challenge",
    hints: [
      "Count the loop iterations when every status is 500.",
      "500 >= 500, but 400 < 500 — which branch runs?",
    ],
  },
  {
    id: "applied-debug-task",
    title: "Debug: the payout validator",
    kind: "debug",
    skillId: "debugging",
    prompt:
      "This payout validator lets bad money through. Fix validate_payouts(records) so it:\n" +
      "- validates amounts with Decimal parsed from the raw string (never float)\n" +
      "- accepts only USD, EUR, GBP (case-insensitive, stripped)\n" +
      "- rejects amounts with more than 2 decimal places (no silent rounding)\n" +
      "- rejects zero, negative, and non-finite amounts\n" +
      '- returns [{"id": ..., "amount": "12.34", "currency": "USD"}] with amounts formatted to 2 decimals\n' +
      "- never raises\n\n" +
      "def validate_payouts(records):\n" +
      "    valid = []\n" +
      "    for record in records:\n" +
      '        amount = float(record["amount"])\n' +
      '        if record["currency"] in ("USD", "EUR", "GBP") and amount > 0:\n' +
      '            valid.append({"id": record["id"], "amount": str(round(amount, 2)), "currency": record["currency"]})\n' +
      "    return valid",
    rubric: ["concept-decimal", "sample", "empty", "invalid", "currency", "money", "shape"],
    graderId: "applied-debug-v1",
    hints: [
      "float('2.675') is not exact — Decimal(str) is.",
      "Check the decimal places before accepting: quantize and compare.",
      'record["amount"] raises KeyError on a missing key — skip instead.',
    ],
  },
  {
    id: "applied-scratch-task",
    title: "Scratch: parse product payloads",
    kind: "scratch",
    skillId: "scratch-coding",
    prompt:
      "Write parse_products(payload) that:\n" +
      "- parses a JSON string payload\n" +
      '- expects a list of {"sku": str, "price": str, "stock": int} dicts\n' +
      "- keeps only rows with non-blank skus, Decimal-parseable prices, and int stocks (bool is not an int)\n" +
      '- returns [{"sku": ..., "price": "12.34", "stock": n}] with prices formatted to 2 decimals\n' +
      "- returns [] for bad JSON, a non-list envelope, or empty input — never raises",
    rubric: ["sample", "empty", "envelope", "price", "stock", "duplicates", "shape", "bad-json"],
    graderId: "applied-scratch-v1",
    hints: [
      "json.loads raises on bad JSON — catch it.",
      "In Python, isinstance(True, int) is True — exclude bools explicitly.",
      "Format prices with exactly two decimals.",
    ],
  },
  {
    id: "applied-project-task",
    title: "Project: reconcile a webhook batch",
    kind: "project",
    skillId: "project-building",
    prompt:
      "Write reconcile_batch(manifest_text, webhook_body) that:\n" +
      "- parses manifest_text as CSV with an id,expected_cents header\n" +
      '- parses webhook_body as JSON, which must be a list of {"id": str, "cents": int} (bool is not an int)\n' +
      '- returns {"ok": [...], "mismatch": [...], "missing": [...], "unexpected": [...]} where\n' +
      "    ok = ids whose cents equal expected_cents,\n" +
      "    mismatch = ids present in both but with different cents,\n" +
      "    missing = manifest ids absent from the webhook,\n" +
      "    unexpected = webhook ids absent from the manifest\n" +
      "- returns all-empty lists for bad JSON or a non-list envelope — never raises",
    rubric: ["concept-json", "sample", "empty", "invalid-json", "schema", "money", "shape"],
    graderId: "applied-project-v1",
    hints: [
      "Parse the CSV with DictReader and the JSON with json.loads, both guarded.",
      "Index the webhook by id first, then walk the manifest.",
      "Compare integer cents — never floats.",
    ],
  },
  {
    id: "applied-explain-task",
    title: "Explain: fallbacks and retries",
    kind: "explain",
    skillId: "design-explanation",
    prompt:
      "1. A batch importer counts accepted rows, but a single corrupt line fails the whole batch. " +
      "Explain why a per-line fallback counter keeps the accepted count deterministic.\n" +
      "2. An API client may retry a failed request once. Should it retry a 429 or a 400? Justify your choice.",
    rubric: ["explain-fallback", "explain-retry"],
    exerciseId: "applied-explain-challenge",
    hints: [
      "What happens to the count when one line aborts everything?",
      "429 means 'slow down'; 400 means 'your request is wrong'.",
    ],
  },
];

export const ASSESSMENTS: Assessment[] = [
  {
    id: "foundations-checkpoint",
    title: "Foundations checkpoint",
    description:
      "Code reading, debugging, and small-program construction with the Python " +
      "recovery and validation-function skills from the foundations missions.",
    tasks: FOUNDATIONS_TASKS,
  },
  {
    id: "data-checkpoint",
    title: "Data checkpoint",
    description:
      "Reading, debugging, and building data pipelines with the CSV, JSON, " +
      "record-transform, and SQLite skills from the data missions.",
    tasks: DATA_TASKS,
  },
  {
    id: "applied-checkpoint",
    title: "Applied checkpoint",
    description:
      "Reading, debugging, and building applied systems with the money, HTTP " +
      "resilience, and LLM-guardrail skills from the applied missions.",
    tasks: APPLIED_TASKS,
  },
];
