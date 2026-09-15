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
      '2. What is the exact value of counts["error"] after the run?\n' +
      "3. In one sentence, state the function's contract: what does it count?",
    rubric: ["read-trace", "read-result", "read-contract"],
    exerciseId: "foundations-read-challenge",
    hints: [
      "Trace the loop line by line for the broken line — which `if` skips it?",
      "Count how many times each level appears.",
      "The contract is about levels, not messages.",
    ],
  },
  {
    id: "foundations-debug-task",
    title: "Debug: the user cleaner",
    kind: "debug",
    skillId: "debugging",
    prompt:
      "This user-table cleaner is supposed to turn messy import rows into clean name/age dicts, " +
      "but it crashes on real data. Fix clean_users(rows) so it:\n" +
      "- skips rows that are not dicts, and rows whose name is missing or not a string\n" +
      "- strips whitespace from each kept name, and skips names that are empty after stripping\n" +
      "- parses each age with int() inside a try block whose except clause names ValueError " +
      "(int() raises ValueError on non-numeric text, not KeyError)\n" +
      "- skips rows whose age is missing, cannot be parsed, or is negative\n" +
      '- returns the cleaned [{"name": ..., "age": ...}] list in order, [] for an empty or non-list input — never raises\n\n' +
      "def clean_users(rows):\n" +
      "    cleaned = []\n" +
      "    for row in rows:\n" +
      '        name = row["name"].strip()\n' +
      '        age = int(row["age"])\n' +
      '        cleaned.append({"name": name, "age": age})\n' +
      "    return cleaned",
    rubric: ["concept-except", "sample", "empty", "invalid", "types", "shape"],
    graderId: "foundations-debug-v1",
    hints: [
      "What happens when row is not a dict, or row[\"name\"] is missing?",
      "int('abc') raises ValueError — which except clause catches it?",
      "Negative ages and blank names must be skipped, not kept.",
    ],
  },
  {
    id: "foundations-scratch-task",
    title: "Scratch: dedupe names",
    kind: "scratch",
    skillId: "scratch-coding",
    prompt:
      "Write dedupe_names(names) that:\n" +
      "- takes a list of raw values\n" +
      "- keeps only strings; strips surrounding whitespace from each\n" +
      "- drops empty results and non-string values\n" +
      '- removes duplicates case-sensitively ("bob" and "BOB" are different names), first occurrence wins\n' +
      "- returns the cleaned list in order, [] for an empty or non-list input — never raises",
    rubric: ["sample", "empty", "invalid", "shape"],
    graderId: "foundations-scratch-v1",
    hints: [
      "Check the type of each value before stripping it.",
      "How do you remember which names you already kept?",
      "Case matters: compare names exactly as stripped.",
    ],
  },
  {
    id: "foundations-project-task",
    title: "Project: build a log report",
    kind: "project",
    skillId: "project-building",
    prompt:
      "Write build_report(path) that:\n" +
      "- opens the file at path with a `with` block (the file must be opened as a context manager)\n" +
      "- ignores blank lines; counts a line as malformed when it has no colon or the level part is empty\n" +
      '- takes the level as the text before the first colon, stripped and uppercased ("error" and "ERROR" are the same level)\n' +
      '- returns {"levels": {LEVEL: count}, "errors": [...], "malformed": n}\n' +
      "- collects errors as the stripped message of each ERROR line, in file order, with duplicates removed\n" +
      '- returns {"levels": {}, "errors": [], "malformed": 0} for an empty file\n' +
      "- lets FileNotFoundError propagate when the path does not exist — do not swallow it",
    rubric: ["concept-with", "sample", "empty", "malformed", "case", "shape", "missing-file"],
    graderId: "foundations-project-v1",
    hints: [
      "A `with open(path) as handle:` block both opens and closes the file.",
      "Split each line on the first colon only.",
      "Only ERROR lines contribute messages, and each distinct message appears once.",
      "A missing file is an error for the caller — don't catch it.",
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
    title: "Debug: the order loader",
    kind: "debug",
    skillId: "debugging",
    prompt:
      "This order loader mangles money on real exports. Fix load_orders(text) so it:\n" +
      "- parses the CSV with csv.DictReader (never split(\",\") by hand)\n" +
      "- returns None when the text cannot be parsed or the header is not exactly id,amount,currency\n" +
      "- strips each id and skips blank ids\n" +
      "- parses each amount with Decimal from the raw string (never float), and skips amounts that are " +
      "unparseable, non-finite, zero, or negative\n" +
      "- accepts only USD, EUR, GBP (case-insensitive, stripped)\n" +
      '- returns [{"id": ..., "amount_cents": <whole cents as int>, "currency": "USD"}] — never raises\n\n' +
      "import csv\n" +
      "from decimal import Decimal\n\n" +
      "def load_orders(text):\n" +
      "    orders = []\n" +
      '    for line in text.strip().split("\\n")[1:]:\n' +
      '        ident, amount, currency = line.split(",")\n' +
      '        orders.append({"id": ident, "amount_cents": int(float(amount) * 100), "currency": currency})\n' +
      "    return orders",
    rubric: ["concept-csv", "concept-decimal", "sample", "empty", "header", "invalid", "shape"],
    graderId: "data-debug-v1",
    hints: [
      "csv.DictReader maps columns by header name — check reader.fieldnames first.",
      "Decimal(str_value) keeps cents exact; float does not.",
      "Zero and negative amounts are not real orders — skip them.",
    ],
  },
  {
    id: "data-scratch-task",
    title: "Scratch: totals by department",
    kind: "scratch",
    skillId: "scratch-coding",
    prompt:
      "Write group_totals(records) that:\n" +
      '- takes a list of {"dept": str, "amount": ...} dicts\n' +
      "- sums amounts per department using Decimal (parsed from the raw value)\n" +
      "- skips rows that are not dicts, rows with blank or non-string depts, and rows whose amount cannot be parsed or is not finite\n" +
      "- strips department names for the result keys\n" +
      '- returns {dept: "12.34"} with totals formatted to exactly 2 decimals\n' +
      "- returns {} for empty or non-list input — never raises",
    rubric: ["sample", "empty", "precision", "invalid", "shape"],
    graderId: "data-scratch-v1",
    hints: [
      "Decimal(str(value)) parses ints, numeric strings, and text amounts exactly.",
      "Add Decimals together, then format each total with exactly two decimals.",
      "Skip, don't crash, on bad rows.",
    ],
  },
  {
    id: "data-project-task",
    title: "Project: reconcile a manifest",
    kind: "project",
    skillId: "project-building",
    prompt:
      "Write reconcile_manifest(manifest_text, confirmed_json) that:\n" +
      "- parses confirmed_json with json.loads; it must be a JSON list of id strings (stripped, blanks dropped)\n" +
      "- parses manifest_text as CSV with csv.DictReader; the header must be exactly id,status\n" +
      '- returns {"matched": [...], "missing": [...], "unexpected": [...]}, each list sorted, where\n' +
      "    matched = settled manifest ids also present in the confirmed list,\n" +
      "    missing = settled manifest ids absent from the confirmed list,\n" +
      "    unexpected = confirmed ids absent from the manifest entirely\n" +
      '- treats blank ids, unknown statuses (only "settled" and "pending" count), and repeated ids (first row wins) as corrupt rows (skipped)\n' +
      '- returns {"matched": [], "missing": [], "unexpected": []} for bad JSON, a non-list envelope, or a wrong header — never raises',
    rubric: ["concept-json", "sample", "empty", "envelope", "invalid", "duplicates", "shape"],
    graderId: "data-project-v1",
    hints: [
      "json.loads can raise — catch it and return the empty result.",
      "Only rows with status 'settled' can match; 'pending' rows are known but unmatched.",
      "Sort each output list before returning it.",
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
      "- strips ids and drops records with blank ids\n" +
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
    title: "Scratch: classify HTTP statuses",
    kind: "scratch",
    skillId: "scratch-coding",
    prompt:
      "Write classify_status(status) that maps an HTTP status code to a client decision:\n" +
      '- 200–299 → "success"\n' +
      '- 429 or 500–599 → "retry"\n' +
      '- anything else → "fail" (1xx, 3xx, other 4xx, and non-integer inputs — note that a bool is not an int here)\n' +
      '- returns exactly one of "success", "retry", or "fail" — never raises',
    rubric: ["boundary-199", "boundary-200", "boundary-299", "boundary-300", "retry-429", "retry-500", "client-404", "invalid"],
    graderId: "applied-scratch-v1",
    hints: [
      "200–299 is the success band; 300 is already a redirect, not success.",
      "429 means 'slow down and retry'; other 4xx responses are client errors.",
      "Check the type first: True is not a valid status code.",
    ],
  },
  {
    id: "applied-project-task",
    title: "Project: guard a payout feed",
    kind: "project",
    skillId: "project-building",
    prompt:
      "Write guard_payouts(lines_text) that:\n" +
      "- takes lines_text, a string with one JSON payout per line\n" +
      "- skips blank lines silently (they are not fallbacks)\n" +
      "- parses each remaining line with json.loads; a line that is not valid JSON, not a JSON object, " +
      "or fails validation counts as one fallback\n" +
      "- validates each payout: id must be a non-blank string, currency must be USD/EUR/GBP " +
      "(case-insensitive, stripped), amount must parse with Decimal, be finite and positive, " +
      "and have at most 2 decimal places (no silent rounding)\n" +
      '- returns {"accepted": [{"id": ..., "amount": "12.34", "currency": "USD"}], "fallback": n} with amounts formatted to 2 decimals\n' +
      '- returns {"accepted": [], "fallback": 0} for empty input — never raises',
    rubric: ["concept-json", "sample", "empty", "invalid-json", "schema", "money", "shape"],
    graderId: "applied-project-v1",
    hints: [
      "Split the input into lines and handle each line on its own.",
      "A per-line try/except keeps one bad line from failing the batch.",
      "Reuse the payout rules: Decimal amounts, known currencies, at most two decimals.",
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
