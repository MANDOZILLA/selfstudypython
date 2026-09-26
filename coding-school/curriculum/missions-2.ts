import type { MissionDefinition, MissionTask, TaskVariant } from "../lib/mission-types";

/**
 * Missions 3-10 of the ten-mission arc (Task 2). Missions 1-2
 * (csv-foundations, json-api-normalization) live in ./missions and are
 * preserved unchanged. Every code task below is bound to a real fail-closed
 * grader in public/grading/mission-suites-2.js, and the task copy
 * (signatures, outputs, validation rules, examples) matches the grader
 * contract exactly. Retrieval variants reuse graders under new contextIds,
 * following the established pattern in ./missions.
 */

const readingVariant = (id: string, contextId: string): TaskVariant => ({
  id, contextId, graderId: "", exerciseId: "", starterFiles: {}, skillChecks: {},
});

const codeVariant = (
  id: string, contextId: string, exerciseId: string, graderId: string,
  starter: string, skillChecks: Record<string, string[]>,
): TaskVariant => ({
  id, contextId, exerciseId, graderId,
  starterFiles: { "main.py": starter },
  skillChecks,
});

const reflectionTask = (
  id: string, title: string, skillIds: string[], prompt: string, requirements: string[],
): MissionTask => ({
  id, title, kind: "explanation", purpose: "reflection", skillIds, introducedSkillIds: [],
  explanation: "Describe your decisions in your own words (" + title + "). The saved reflection supports your learning journal; it is not an automatically graded correctness claim. Reopen the project whenever a counterexample exposes a gap.",
  examples: [prompt],
  requirements: [...requirements, "Write at least 20 characters."],
  hints: [],
  variants: [readingVariant(`${id}-v1`, `${id}-reflection`)],
});

export const MISSIONS_2: MissionDefinition[] = [
  {
    id: "python-recovery",
    version: "1.0.0",
    title: "Crash Course: Reading Tracebacks",
    summary: "Turn cryptic stack traces into exact bug locations, then build a crash-log scanner that never crashes on bad input.",
    prerequisites: ["json-api-normalization"],
    introducedSkillIds: ["python-exceptions", "file-io"],
    revisitedSkillIds: ["python-functions"],
    estimatedMinutes: 30,
    stages: [
      {
        id: "recovery-review", kind: "review", title: "Review", estimatedMinutes: 4, advanceRule: "attempt-review",
        tasks: [
          {
            id: "recovery-review-functions", title: "Recall: functions and guards", kind: "instruction", purpose: "instruction",
            skillIds: ["python-functions"], introducedSkillIds: [],
            explanation: "Before reading crashes, recall the tools that prevent them. A function with a clear return contract is easier to debug than a script: solve(text) always returns the same shape. Guard clauses — if type(x) is not str: return ... — turn a crash into a value. You used these in the payments CSV and API missions; the crash-log scanner you build today leans on the same guards.",
            examples: [
              "def solve(text):\n    if type(text) is not str:\n        return {}\n    # every path below returns a dict",
              "Guards first, parsing second: the guard decides the shape, the parser fills it.",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("recovery-review-reading-v1", "recovery-review")],
          },
        ],
      },
      {
        id: "recovery-learn", kind: "learn", title: "Learn", estimatedMinutes: 9, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "recovery-instruction", title: "How to read a traceback", kind: "instruction", purpose: "instruction",
            skillIds: ["python-exceptions"], introducedSkillIds: ["python-exceptions"],
            explanation: "A traceback has three parts. The header 'Traceback (most recent call last):' starts the story; frames follow in call order (first frame = entry point, last frame = where the exception was raised); the final line 'ValueError: amount must be positive' names the error type and message. Read the error line first to know WHAT failed, then the frames top-down to know WHERE. Chained exceptions print several traceback blocks separated by 'The above exception was the direct cause...' — the LAST block is the error that actually escaped; earlier blocks are context. SyntaxError is special: the parser never ran the code, so its frame records the function as the empty string.",
            examples: [
              "Traceback (most recent call last):\n  File \"shop.py\", line 5, in checkout\n    charge(-3)\n  File \"orders.py\", line 2, in charge\n    raise ValueError(\"amount must be positive\")\nValueError: amount must be positive\n# type=ValueError, message='amount must be positive'; frames in call order: checkout then charge.",
              "Two traceback blocks with 'The above exception...' between them means chaining: parse ONLY the last block. The first exception explains the cause; the last one is what the program died with.",
              "File \"app.py\", line 1\n    def broken(:\n              ^\nSyntaxError: invalid syntax\n# The frame for a SyntaxError has function \"\" — no function was entered.",
            ],
            requirements: ["Read the examples, trace one chained traceback by hand, and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("recovery-reading-v1", "recovery-teaching")],
          },
          {
            id: "traceback-guided", title: "Guided practice: parse a traceback", kind: "code", purpose: "guided-practice",
            skillIds: ["python-exceptions"], introducedSkillIds: ["python-exceptions"],
            explanation: "Write solve(text) that parses one traceback string into {\"type\": ..., \"message\": ..., \"frames\": [{\"file\": ..., \"line\": ..., \"function\": ...}, ...]}. Use two regexes: ^([A-Za-z_]\\w*(?:Error|Exception))\\s*: for the error line and ^\\s*File \"([^\"]+)\", line (\\d+), in (\\S.*)$ for frames. Slice from the LAST 'Traceback (most recent call last):' header so chained context is ignored. Convert line numbers to int. If text is not a string, return the all-empty shape.",
            examples: [
              "Input: 'Traceback (most recent call last):\\n  File \"shop.py\", line 5, in checkout\\n    charge(-3)\\n  File \"orders.py\", line 2, in charge\\n    raise ValueError(\"amount must be positive\")\\nValueError: amount must be positive'\nOutput: {\"type\": \"ValueError\", \"message\": \"amount must be positive\", \"frames\": [{\"file\": \"shop.py\", \"line\": 5, \"function\": \"checkout\"}, {\"file\": \"orders.py\", \"line\": 2, \"function\": \"charge\"}]}",
              "Input: tb_file_not_found + '\\nThe above exception was the direct cause of the following exception:\\n\\n' + tb_runtime_error\nOutput: {\"type\": \"RuntimeError\", ...} — only the last block is parsed.",
              "Input: None\nOutput: {\"type\": \"\", \"message\": \"\", \"frames\": []}",
            ],
            requirements: [
              "Define solve(text). Non-string input returns {\"type\": \"\", \"message\": \"\", \"frames\": []}; never raise.",
              "Parse only the LAST 'Traceback (most recent call last):' block when several appear.",
              "frames lists every frame in call order as {\"file\": str, \"line\": int, \"function\": str}.",
              "A SyntaxError frame records \"function\" as \"\".",
              "type and message come from the block's final error line, split on the first ':'.",
            ],
            hints: [
              "Find every line whose stripped text equals 'Traceback (most recent call last):' and slice from the last index.",
              "The error line is the LAST line in the block matching the error regex; frames are every line matching the File regex.",
              "Use re.match with ^...$ on each line; remember int() for the line number.",
            ],
            variants: [codeVariant(
              "traceback-v1", "traceback-parse", "traceback-challenge", "traceback-v1",
              "import re\n\nERROR_RE = re.compile(r\"^([A-Za-z_]\\w*(?:Error|Exception))\\s*:\")\nFRAME_RE = re.compile(r'^\\\\s*File \"([^\"]+)\", line (\\\\d+), in (\\\\S.*)$')\n\ndef solve(text):\n    # 1. Guard non-string input with the all-empty shape.\n    # 2. Slice from the LAST traceback header.\n    # 3. Classify each line: frame -> append, error line -> remember.\n    return {\"type\": \"\", \"message\": \"\", \"frames\": []}\n",
              { "python-exceptions": ["sample", "empty", "invalid", "chained", "syntax"] },
            )],
          },
          {
            id: "logscan-guided", title: "Guided practice: count log levels", kind: "code", purpose: "guided-practice",
            skillIds: ["file-io", "python-exceptions"], introducedSkillIds: ["file-io"],
            explanation: "Write solve(path) that counts log lines by level. Open the file with a with block and call open(path) with the path argument on the executed path. Count lines whose left-stripped text starts with ERROR, WARN, or INFO into {\"error\": ..., \"warning\": ..., \"info\": ...}. A non-string path or an unreadable file returns the all-zero shape — the scanner reports, it never raises.",
            examples: [
              "Input file lines: 'INFO start\\nERROR boom\\nWARN slow\\nERROR bust\\n'\nOutput: {\"error\": 2, \"warning\": 1, \"info\": 1}",
              "Input: 'nope.log' (missing)\nOutput: {\"error\": 0, \"warning\": 0, \"info\": 0}",
              "Input: None\nOutput: {\"error\": 0, \"warning\": 0, \"info\": 0}",
            ],
            requirements: [
              "Define solve(path). Call open(path) with the path and read it inside a with block on the executed path.",
              "Count lines starting with ERROR / WARN / INFO after stripping leading whitespace.",
              "Non-string paths and unreadable files return {\"error\": 0, \"warning\": 0, \"info\": 0}; never raise.",
            ],
            hints: [
              "Guard type(path) is not str first, then try/except OSError around the with block.",
              "Use line.lstrip().startswith(\"ERROR\") so indented log lines still count.",
              "Initialize all three counters to 0 before the loop.",
            ],
            variants: [codeVariant(
              "logscan-v1", "log-levels", "logscan-challenge", "logscan-v1",
              "def solve(path):\n    counts = {\"error\": 0, \"warning\": 0, \"info\": 0}\n    # 1. Guard non-string path.\n    # 2. with open(path) as handle: count each line's level.\n    # 3. On OSError return the all-zero shape.\n    return counts\n",
              { "file-io": ["concept-open", "concept-with", "sample"], "python-exceptions": ["empty", "invalid", "shape"] },
            )],
          },
        ],
      },
      {
        id: "recovery-build", kind: "build", title: "Build", estimatedMinutes: 13, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "crash-log-scanner", title: "Project: crash-log scanner", kind: "code", purpose: "project",
            skillIds: ["file-io", "python-exceptions"], introducedSkillIds: [],
            portfolioProjectId: "portfolio-data-pipeline",
            explanation: "Build the whole scanner yourself: solve(path) reads a line-delimited JSON crash log and counts errors by name. Open the file with a with block. For each non-blank line, json.loads it — a failure counts as \"unparsed\". Take the record's traceback field; if it is not a string, count \"unparsed\". Otherwise extract the error name from the LAST traceback block with ^([A-Za-z_]\\w*(?:Error|Exception))\\s*: and count it. Records with no error line also count as \"unparsed\". A missing file, None, or a non-string path returns {} — report, never raise. This scanner becomes the first stage of your data-pipeline portfolio project: raw crash logs in, structured error counts out.",
            examples: [
              "Input file: '{\"traceback\": \"Traceback (most recent call last):\\n  File \\\"a.py\\\", line 1, in <module>\\nZeroDivisionError: division by zero\"}\\nnot json\\n{\"traceback\": 42}\\n'\nOutput: {\"ZeroDivisionError\": 1, \"unparsed\": 2}",
              "Input: 'missing.log'\nOutput: {}",
              "Input: '' (empty file)\nOutput: {}",
            ],
            requirements: [
              "Define solve(path). Open the file inside a with statement on the executed path; a missing/unreadable file or a non-string path returns {}.",
              "Extract the error name from the LAST traceback block of each record's traceback string.",
              "Non-JSON lines, non-string tracebacks, and records with no error line count as \"unparsed\".",
              "Return a dict mapping error-name strings to integer counts; an empty file returns {}.",
            ],
            hints: [
              "Wrap open() in try/except (OSError, TypeError) and return {} in the handler.",
              "Write an error_name(text) helper: split into lines, find the last traceback header, scan the rest for the error regex.",
              "Skip blank lines before json.loads so trailing newlines do not inflate \"unparsed\".",
              "Count \"unparsed\" in three places: json failure, traceback not a str, error_name returning None.",
            ],
            variants: [codeVariant(
              "recovery-project-v1", "crash-logs", "recovery-project-challenge", "recovery-project-v1",
              "import json\nimport re\n\nERROR_RE = re.compile(r\"^([A-Za-z_]\\w*(?:Error|Exception))\\s*:\")\n\ndef error_name(text):\n    # Error name from the LAST traceback block, or None.\n    return None\n\ndef solve(path):\n    counts = {}\n    # 1. with open(path): read lines; on OSError/TypeError return {}.\n    # 2. Per line: json.loads, count \"unparsed\" on failure.\n    # 3. error_name(record.get(\"traceback\")) -> count name or \"unparsed\".\n    return counts\n",
              { "file-io": ["concept-open", "concept-with", "sample"], "python-exceptions": ["no-crash", "empty", "missing", "shape"] },
            )],
          },
        ],
      },
      {
        id: "recovery-explain", kind: "explain", title: "Explain", estimatedMinutes: 4, advanceRule: "complete-tasks",
        tasks: [
          reflectionTask(
            "recovery-reflection", "Explain your scanner's failure policy", ["python-exceptions", "file-io"],
            "When does your scanner return {} versus {\"unparsed\": n}, and why is that distinction useful to whoever reads the counts?",
            [
              "Explain why the scanner counts malformed lines as data instead of raising.",
              "Explain why only the last traceback block is parsed when exceptions chain.",
              "Give one concrete log line that lands in \"unparsed\" and say which rule puts it there.",
            ],
          ),
        ],
      },
    ],
  },
  {
    id: "validation-functions",
    version: "1.0.0",
    title: "Validation You Can Reuse",
    summary: "Write small validator functions once, then combine them into a signup validator that reports every problem.",
    prerequisites: ["python-recovery"],
    introducedSkillIds: [],
    revisitedSkillIds: ["python-functions", "python-exceptions"],
    estimatedMinutes: 40,
    stages: [
      {
        id: "validation-review", kind: "review", title: "Review", estimatedMinutes: 4, advanceRule: "attempt-review",
        tasks: [
          {
            id: "validation-review-tracebacks", title: "Recall: report, never raise", kind: "instruction", purpose: "instruction",
            skillIds: ["python-exceptions"], introducedSkillIds: [],
            explanation: "Last mission you built a scanner that returns {} for a missing file instead of raising. Validation works the same way: a validator returns a verdict, it does not crash the caller. The difference is granularity — instead of one {} for the whole input, validators report per-field, per-record verdicts so the caller can fix exactly what is wrong.",
            examples: [
              "Scanner: bad file -> {} (one verdict for the whole input).",
              "Validator: bad record -> {\"index\": 2, \"reasons\": [\"email:bad-format\"]} (a verdict per record).",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("validation-review-reading-v1", "validation-review")],
          },
        ],
      },
      {
        id: "validation-learn", kind: "learn", title: "Learn", estimatedMinutes: 12, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "validation-instruction", title: "One helper per rule", kind: "instruction", purpose: "instruction",
            skillIds: ["python-functions"], introducedSkillIds: [],
            explanation: "A reusable validator is a small function with one job: take a value, return a verdict. Helpers like is_valid_username(value) keep solve() readable and let other missions import the rule without copying the logic. Call the helper from solve — defining it is not enough; the grader checks that solve actually calls a helper on the executed path. Exact type checks matter: type(value) is int rejects True, while isinstance(True, int) accepts it. For strings, strip first, then check length and characters: all(ch.isalnum() or ch == \"_\" for ch in name).",
            examples: [
              "def is_valid_username(value):\n    if type(value) is not str:\n        return None\n    name = value.strip()\n    if not 3 <= len(name) <= 20:\n        return None\n    if not all(ch.isalnum() or ch == \"_\" for ch in name):\n        return None\n    return name",
              "type(True) is int  # False — bool is rejected\nisinstance(True, int)  # True — bool slips through; prefer exact type checks for validated input.",
              "def solve(users):\n    ...\n    username = is_valid_username(row.get(\"username\"))  # the call is what counts",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("validation-reading-v1", "validation-teaching")],
          },
          {
            id: "validators-guided", title: "Guided practice: filter valid users", kind: "code", purpose: "guided-practice",
            skillIds: ["python-functions", "python-exceptions"], introducedSkillIds: [],
            explanation: "Write solve(users) that returns the stripped usernames of valid records. Define at least one helper validator (e.g. is_valid_username, is_valid_age) and CALL it from solve on the executed path. Rules: username must be a str whose stripped form is 3-20 chars of letters/digits/underscore; age must have exact type int (bool rejected) and be 13-120 inclusive. Non-list input returns [].",
            examples: [
              "Input: [{\"username\": \" amy \", \"age\": 30}, {\"username\": \"bo\", \"age\": 25}, {\"username\": \"cy_99\", \"age\": 12}, {\"username\": \"dee\", \"age\": True}]\nOutput: [\"amy\"]",
              "Input: [{\"username\": \"x\" * 20, \"age\": 120}, {\"username\": \"y\" * 21, \"age\": 13}, {\"username\": \"dash-name\", \"age\": 40}]\nOutput: [\"xxxxxxxxxxxxxxxxxxxx\"]",
              "Input: None\nOutput: []",
            ],
            requirements: [
              "Define solve(users). Non-list input returns []; never raise.",
              "Define at least one helper function and call it from solve on the executed path.",
              "username: str, stripped length 3-20, only letters/digits/underscore.",
              "age: exact type int (booleans rejected), 13-120 inclusive.",
              "Return stripped usernames of valid records in input order.",
            ],
            hints: [
              "Write is_valid_username(value) returning the stripped name or None, and is_valid_age(value) returning a bool.",
              "In solve, call the helpers for each row; skip the row when either fails.",
              "Remember type(value) is int excludes True; isinstance would accept it.",
            ],
            variants: [codeVariant(
              "validators-v1", "user-filter", "validators-challenge", "validators-v1",
              "def is_valid_username(value):\n    # Return the stripped name, or None.\n    return None\n\ndef is_valid_age(value):\n    # Return True only for exact ints in 13..120.\n    return False\n\ndef solve(users):\n    if type(users) is not list:\n        return []\n    result = []\n    # Call the helpers for each row; append valid usernames.\n    return result\n",
              { "python-functions": ["concept-reuse", "sample", "shape"], "python-exceptions": ["empty", "invalid"] },
            )],
          },
        ],
      },
      {
        id: "validation-build", kind: "build", title: "Build", estimatedMinutes: 20, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "signup-validation-project", title: "Project: signup validator", kind: "code", purpose: "project",
            skillIds: ["python-functions", "python-exceptions"], introducedSkillIds: [],
            explanation: "Build the whole validator yourself: solve(records) splits signup records into valid ones and per-record error reports. Define helper validators (check_username, check_email, check_age) and CALL them from solve. Rules: username is a str with stripped length 3-20; email is a str with exactly one '@', nonempty local and domain parts, and no whitespace; age has exact type int (bool rejected) and is 13-120. Return {\"valid\": [{\"username\": stripped, \"email\": stripped, \"age\": int}, ...], \"errors\": [{\"index\": i, \"reasons\": [\"field:reason\", ...]}, ...]}. Report ALL failing reasons per record (e.g. [\"email:bad-format\", \"age:out-of-range\"]); non-dict records get [\"not-a-record\"]. Non-list input returns {\"valid\": [], \"errors\": []}. Never mutate the input.",
            examples: [
              "Input: [{\"username\": \" amy \", \"email\": \"a@x.com\", \"age\": 30}, {\"username\": \"bo\", \"email\": \"b@x.com\", \"age\": 25}]\nOutput: {\"valid\": [{\"username\": \"amy\", \"email\": \"a@x.com\", \"age\": 30}], \"errors\": [{\"index\": 1, \"reasons\": [\"username:bad-length\"]}]}",
              "Input: [{\"username\": \"cat\", \"email\": \"bad\", \"age\": -1}, \"junk\"]\nOutput: {\"valid\": [], \"errors\": [{\"index\": 0, \"reasons\": [\"email:bad-format\", \"age:out-of-range\"]}, {\"index\": 1, \"reasons\": [\"not-a-record\"]}]}",
              "Input: [{\"username\": \"ok\", \"email\": \"e@x.com\", \"age\": True}]\nOutput: {\"valid\": [], \"errors\": [{\"index\": 0, \"reasons\": [\"username:bad-length\", \"age:not-an-int\"]}]}",
            ],
            requirements: [
              "Define solve(records). Non-list input returns {\"valid\": [], \"errors\": []}; never raise and never mutate the input.",
              "Define at least one helper validator and call it from solve on the executed path.",
              "username: stripped str of length 3-20. email: str with exactly one '@', nonempty local/domain, no whitespace. age: exact int, 13-120 (booleans rejected).",
              "valid holds {\"username\", \"email\", \"age\"} dicts with stripped strings; errors holds {\"index\", \"reasons\"} with EVERY failing reason as \"field:reason\".",
              "Non-dict records produce {\"index\": i, \"reasons\": [\"not-a-record\"]}; indices count every input record.",
            ],
            hints: [
              "Have each helper return None when valid or a short reason string when invalid.",
              "In solve, call all three helpers per record and collect \"field:\" + reason for each failure.",
              "Check email with text.count(\"@\") == 1, then split and verify both parts are nonempty with no whitespace.",
              "Guard type(value) is bool before type(value) is int for the age check.",
            ],
            variants: [codeVariant(
              "validation-project-v1", "signup-records", "validation-project-challenge", "validation-project-v1",
              "def check_username(value):\n    # None when valid, else a reason like \"bad-length\".\n    return None\n\ndef check_email(value):\n    return None\n\ndef check_age(value):\n    return None\n\ndef solve(records):\n    if type(records) is not list:\n        return {\"valid\": [], \"errors\": []}\n    valid, errors = [], []\n    # Call the helpers per record; collect every \"field:reason\".\n    return {\"valid\": valid, \"errors\": errors}\n",
              { "python-functions": ["concept-reuse", "sample", "reasons", "shape"], "python-exceptions": ["empty", "invalid"] },
            )],
          },
        ],
      },
      {
        id: "validation-explain", kind: "explain", title: "Explain", estimatedMinutes: 4, advanceRule: "complete-tasks",
        tasks: [
          reflectionTask(
            "validation-reflection", "Explain your helper design", ["python-functions", "python-exceptions"],
            "Why does each helper return a reason string instead of True/False, and what would break if solve inlined all the checks?",
            [
              "Explain what the caller can do with \"email:bad-format\" that it cannot do with False.",
              "Explain why solve must call the helpers rather than duplicate their logic.",
              "Give one input where reporting all reasons beats reporting the first failure.",
            ],
          ),
        ],
      },
    ],
  },
  {
    id: "transform-records",
    version: "1.0.0",
    title: "Transform Nested Records",
    summary: "Flatten nested catalogs and aggregate orders with comprehensions, exact decimals, and strict item validation.",
    prerequisites: ["validation-functions"],
    introducedSkillIds: [],
    revisitedSkillIds: ["python-functions", "data-structures", "python-exceptions"],
    estimatedMinutes: 45,
    stages: [
      {
        id: "transform-review", kind: "review", title: "Review", estimatedMinutes: 5, advanceRule: "attempt-review",
        tasks: [
          {
            id: "transform-review-validation", title: "Recall: validate then collect", kind: "instruction", purpose: "instruction",
            skillIds: ["python-functions", "data-structures"], introducedSkillIds: [],
            explanation: "Your signup validator used one pattern: guard each record, normalize, collect the survivors. Transformations reuse it at two levels. First validate the envelope (is this order a dict with a usable customer and an items list?). Then validate each nested item (is the sku a non-blank string? is qty an exact int?). Invalid items are skipped without killing the whole order — but an order with zero valid items contributes nothing. Comprehensions express the inner loop: [entry for entry in (valid_item(i) for i in items) if entry is not None].",
            examples: [
              "[entry for entry in (valid_item(i) for i in items) if entry is not None]\n# validate each item, keep the survivors — one line, no append loop.",
              "An order whose every item is invalid is skipped entirely: it has no valid entries to aggregate.",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("transform-review-reading-v1", "transform-review")],
          },
        ],
      },
      {
        id: "transform-learn", kind: "learn", title: "Learn", estimatedMinutes: 13, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "transform-instruction", title: "Aggregate with exact money", kind: "instruction", purpose: "instruction",
            skillIds: ["data-structures"], introducedSkillIds: [],
            explanation: "Aggregating money means grouping by a key and summing qty * price with Decimal — never float. Build a groups dict keyed by customer: [order_count, total_qty, total_decimal]. For each order with at least one valid item, bump the counters. Format the final total with format(total.quantize(Decimal(\"0.01\")), \".2f\") so \"8.3\" becomes \"8.30\". Sort groups by customer name for a stable report. And use at least one comprehension on the executed path — the grader checks for it, because comprehensions are the idiomatic shape of a transform.",
            examples: [
              "groups = {}\nentry = groups.setdefault(customer, [0, 0, Decimal(\"0\")])\nentry[0] += 1; entry[1] += qty; entry[2] += qty * price",
              "format(Decimal(\"8.3\").quantize(Decimal(\"0.01\")), \".2f\")  # '8.30'",
              "[{\"customer\": n, \"orders\": c[0], \"items\": c[1], \"total\": fmt(c[2])} for n, c in sorted(groups.items())]",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("transform-reading-v1", "transform-teaching")],
          },
          {
            id: "transform-guided", title: "Guided practice: aggregate orders", kind: "code", purpose: "guided-practice",
            skillIds: ["python-functions", "data-structures"], introducedSkillIds: [],
            explanation: "Write solve(orders) that aggregates nested order items by customer. Define a helper (e.g. valid_item) and use at least one comprehension on the executed path. Rules: order must be a dict with a non-blank string customer and an items list; item must be a dict with a non-blank string sku, qty of exact type int (bool rejected) and >= 0, and price as a str parseable by Decimal that is finite and >= 0. Skip invalid items; skip orders with no valid items. Return [{\"customer\": name, \"orders\": order_count, \"items\": total_qty, \"total\": \"0.00\"}] sorted by customer, with totals formatted to two decimals. Non-list input returns [].",
            examples: [
              "Input: [{\"customer\": \"amy\", \"items\": [{\"sku\": \"a\", \"qty\": 2, \"price\": \"1.50\"}, {\"sku\": \"b\", \"qty\": 1, \"price\": \"5.35\"}]}, {\"customer\": \"amy\", \"items\": [{\"sku\": \"c\", \"qty\": 1, \"price\": \"2.00\"}]}]\nOutput: [{\"customer\": \"amy\", \"orders\": 2, \"items\": 4, \"total\": \"10.35\"}]",
              "Input: [{\"customer\": \"amy\", \"items\": [{\"sku\": \"a\", \"qty\": True, \"price\": \"1.00\"}]}, {\"customer\": \" \", \"items\": []}]\nOutput: []",
              "Input: \"nope\"\nOutput: []",
            ],
            requirements: [
              "Define solve(orders). Non-list input returns []; never raise.",
              "Use at least one comprehension (list, dict, set, or generator) on the executed path.",
              "Validate orders and items with exact type checks; skip invalid items and orders with no valid items.",
              "Group by stripped customer name; orders counts orders, items sums qty, total sums qty*price as Decimal formatted \"0.00\".",
              "Return groups sorted by customer name.",
            ],
            hints: [
              "Write valid_item(item) returning (qty, price) or None; call it inside a comprehension.",
              "qty needs type(...) is int and >= 0 — True must fail.",
              "Parse price with Decimal(item[\"price\"].strip()); require is_finite() and >= 0.",
            ],
            variants: [codeVariant(
              "transform-v1", "order-aggregation", "transform-challenge", "transform-v1",
              "from decimal import Decimal, InvalidOperation\n\ndef valid_item(item):\n    # Return (qty, price) for a valid item, else None.\n    return None\n\ndef solve(orders):\n    if type(orders) is not list:\n        return []\n    groups = {}\n    # Per order: guard customer/items, collect valid entries with a comprehension,\n    # aggregate into groups, return sorted rows with \"0.00\" totals.\n    return []\n",
              { "python-functions": ["concept-comprehension", "sample", "shape"], "data-structures": ["empty", "invalid", "precision"] },
            )],
          },
        ],
      },
      {
        id: "transform-build", kind: "build", title: "Build", estimatedMinutes: 23, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "catalog-transformer-project", title: "Project: flatten a product catalog", kind: "code", purpose: "project",
            skillIds: ["python-functions", "data-structures", "python-exceptions"], introducedSkillIds: [],
            explanation: "Build the whole transformer yourself: solve(catalog) flattens a nested category/product/variant catalog into order lines. catalog is a list of {\"category\": name, \"products\": [{\"name\": ..., \"variants\": [{\"sku\": ..., \"price\": ...}]}]}. Skip anything malformed at any level (non-dict, blank names, non-list products/variants). A variant is valid only when sku is a non-blank string and price is a string holding a finite, nonnegative Decimal with EXACTLY two decimal places — \"1.005\" and \"2.675\" are rejected, not rounded. Use at least one comprehension. Return [{\"category\": ..., \"product\": ..., \"sku\": ..., \"price\": \"0.00\"}] with stripped strings, in input order. Build new dicts; never mutate the input. Non-list input returns [].",
            examples: [
              "Input: [{\"category\": \" books \", \"products\": [{\"name\": \"Atlas\", \"variants\": [{\"sku\": \"A1\", \"price\": \"12.50\"}, {\"sku\": \"\", \"price\": \"9.99\"}]}]}]\nOutput: [{\"category\": \"books\", \"product\": \"Atlas\", \"sku\": \"A1\", \"price\": \"12.50\"}]",
              "Input: [{\"category\": \"c\", \"products\": [{\"name\": \"p\", \"variants\": [{\"sku\": \"S1\", \"price\": \"1.005\"}, {\"sku\": \"S2\", \"price\": \"0.10\"}]}]}]\nOutput: [{\"category\": \"c\", \"product\": \"p\", \"sku\": \"S2\", \"price\": \"0.10\"}]",
              "Input: None\nOutput: []",
              "Input: [{\"category\": \"c\", \"products\": [{\"name\": \"p\", \"variants\": [{\"sku\": \"S1\", \"price\": \"12.50\", \"extra\": 1}]}]}]\nOutput: [{\"category\": \"c\", \"product\": \"p\", \"sku\": \"S1\", \"price\": \"12.50\"}] — extra keys ignored, input dicts untouched.",
            ],
            requirements: [
              "Define solve(catalog). Non-list input returns []; never raise and never mutate the input.",
              "Use at least one comprehension on the executed path.",
              "Skip malformed categories, products, and variants; validate every level with exact type checks.",
              "Accept only prices that are finite, nonnegative, and exactly two decimals; format accepted prices as \"0.00\".",
              "Return new dicts with exactly category/product/sku/price, stripped, in input order.",
            ],
            hints: [
              "Write parse_price(text) returning a Decimal or None; reject when value.quantize(Decimal(\"0.01\")) != value.",
              "Filter variants with a comprehension, then loop the survivors to build output rows.",
              "Strip category, product, and sku; drop blanks at every level.",
              "Copy values into fresh dicts — never append the input's dicts.",
            ],
            variants: [codeVariant(
              "transform-project-v1", "catalog-flatten", "transform-project-challenge", "transform-project-v1",
              "from decimal import Decimal, InvalidOperation\n\ndef parse_price(text):\n    # Return a Decimal with exactly two decimals, or None.\n    return None\n\ndef solve(catalog):\n    if type(catalog) is not list:\n        return []\n    result = []\n    # Walk categories -> products -> variants with guards at each level;\n    # use a comprehension to filter variants; append fresh dicts.\n    return result\n",
              { "python-functions": ["concept-comprehension", "sample"], "data-structures": ["invalid", "precision", "shape"], "python-exceptions": ["empty"] },
            )],
          },
        ],
      },
      {
        id: "transform-explain", kind: "explain", title: "Explain", estimatedMinutes: 4, advanceRule: "complete-tasks",
        tasks: [
          reflectionTask(
            "transform-reflection", "Explain your price rule", ["data-structures", "python-functions"],
            "Why does your transformer reject \"1.005\" instead of rounding it, and what would silently rounding cost a real catalog?",
            [
              "Explain the difference between rejecting and rounding a three-decimal price.",
              "Explain why the transformer builds new dicts instead of reusing the input's.",
              "Give one input/output pair showing a skipped variant and the rule that skipped it.",
            ],
          ),
        ],
      },
    ],
  },
  {
    id: "pandas-missing-data",
    version: "1.0.0",
    title: "Missing Data, Found Data",
    summary: "Clean messy CSVs with pandas: fill gaps with medians, quarantine bad rows, and summarize quality per region.",
    prerequisites: ["transform-records"],
    introducedSkillIds: ["pandas-data-quality"],
    revisitedSkillIds: ["python-functions", "csv-cleaning", "data-structures"],
    estimatedMinutes: 60,
    stages: [
      {
        id: "pandas-review", kind: "review", title: "Review", estimatedMinutes: 5, advanceRule: "attempt-review",
        tasks: [
          {
            id: "pandas-review-transform", title: "Recall: validate then collect, at scale", kind: "instruction", purpose: "instruction",
            skillIds: ["data-structures"], introducedSkillIds: [],
            explanation: "Your order aggregator validated each item, skipped the bad ones, and grouped the survivors. pandas does the same thing to whole columns at once: df[df[\"id\"] != \"\"] keeps the survivors; fillna(median) repairs a column; groupby(\"region\") groups them. The rules you wrote by hand become one-liners — but the decisions (what counts as missing, what fills it) are still yours.",
            examples: [
              "df = df[df[\"id\"].notna()]  # keep the survivors, like skipping invalid items",
              "df[\"amount\"].fillna(df[\"amount\"].median())  # repair the column, like defaulting a bad price",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("pandas-review-reading-v1", "pandas-review")],
          },
        ],
      },
      {
        id: "pandas-learn", kind: "learn", title: "Learn", estimatedMinutes: 18, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "pandas-instruction", title: "Pandas runs offline here", kind: "instruction", purpose: "instruction",
            skillIds: ["pandas-data-quality"], introducedSkillIds: ["pandas-data-quality"],
            explanation: "pandas and numpy are vendored as local wheels — import pandas works with zero network requests, and the grader verifies no HTTP happens. Read CSV text with pd.read_csv(io.StringIO(csv_text)). Missing values arrive as NaN: use pd.to_numeric(col, errors=\"coerce\") to force bad text to NaN, then fillna. The median (not the mean) fills amounts because one huge outlier would drag the mean away from typical values; when every amount is missing, the median is NaN, so fall back to 0.0. Quantities must be whole: coerce, then keep values that are not NaN and have no fractional part, else 0, as int. Blank regions become \"unknown\". The grader checks that pandas is actually used on the executed path — a csv-module rewrite fails.",
            examples: [
              "df[\"amount\"] = pd.to_numeric(df[\"amount\"], errors=\"coerce\")\nmedian = df[\"amount\"].median()\nif pd.isna(median):\n    median = 0.0\ndf[\"amount\"] = df[\"amount\"].fillna(median).round(2)",
              "qty = pd.to_numeric(df[\"qty\"], errors=\"coerce\")\ndf[\"qty\"] = qty.where(qty.notna() & (qty % 1 == 0), 0).astype(int)\n# 2.0 -> 2, \"x\" -> 0, 1.5 -> 0",
              "df[\"region\"] = df[\"region\"].astype(object).where(df[\"region\"].notna(), \"\").astype(str).str.strip().replace(\"\", \"unknown\")",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("pandas-reading-v1", "pandas-teaching")],
          },
          {
            id: "pandas-clean-guided", title: "Guided practice: clean a sales CSV", kind: "code", purpose: "guided-practice",
            skillIds: ["pandas-data-quality", "python-functions"], introducedSkillIds: [],
            explanation: "Write solve(csv_text) that cleans CSV text with columns id,region,amount,qty into a list of dicts. Import pandas and use it on the executed path (pd.read_csv on io.StringIO). Drop rows with blank/missing ids and sort by id. Fill missing amounts with the column median (0.0 when the median itself is missing) rounded to 2 decimals; set missing or non-integer qty to 0; set blank/missing region to \"unknown\". Return [{\"id\": str, \"region\": str, \"amount\": float, \"qty\": int}]. Non-string or blank input returns []; a missing id/region/amount/qty column returns [].",
            examples: [
              "Input: 'id,region,amount,qty\\nb,west,10.00,2\\na,,5.00,\\nc,east,,1.5\\n'\nOutput: [{\"id\": \"a\", \"region\": \"unknown\", \"amount\": 5.0, \"qty\": 0}, {\"id\": \"b\", \"region\": \"west\", \"amount\": 10.0, \"qty\": 2}, {\"id\": \"c\", \"region\": \"east\", \"amount\": 7.5, \"qty\": 0}]",
              "Input: 'id,region,amount,qty\\n,west,1.00,1\\n'\nOutput: [] — the only row has a blank id.",
              "Input: ''\nOutput: []",
            ],
            requirements: [
              "Define solve(csv_text). Non-string or blank input returns []; missing id/region/amount/qty columns return [].",
              "Import pandas and use it on the executed path to read and clean the data.",
              "Drop rows with blank/missing ids; sort the survivors by id.",
              "Fill missing amounts with the median (0.0 if the median is missing), rounded to 2; qty missing/non-integer becomes 0; blank region becomes \"unknown\".",
              "Return [{\"id\": str, \"region\": str, \"amount\": float, \"qty\": int}].",
            ],
            hints: [
              "Start: df = pd.read_csv(io.StringIO(csv_text)); check each required column with `col not in df.columns`.",
              "Normalize ids: where(notna(), \"\").astype(str).str.strip(), then keep df[id != \"\"].",
              "amount: pd.to_numeric(errors=\"coerce\"), median, isna -> 0.0, fillna, round(2).",
            ],
            variants: [codeVariant(
              "pandas-clean-v1", "sales-cleanup", "pandas-clean-challenge", "pandas-clean-v1",
              "import io\nimport pandas as pd\n\ndef solve(csv_text):\n    if type(csv_text) is not str or not csv_text.strip():\n        return []\n    df = pd.read_csv(io.StringIO(csv_text))\n    for col in (\"id\", \"region\", \"amount\", \"qty\"):\n        if col not in df.columns:\n            return []\n    # 1. Normalize ids, drop blanks, sort.\n    # 2. amount -> numeric, fill median (0.0 fallback), round 2.\n    # 3. qty -> 0 unless a whole number; region blanks -> \"unknown\".\n    return []\n",
              { "pandas-data-quality": ["concept-pandas", "sample", "invalid", "missing", "shape"], "python-functions": ["empty"] },
            )],
          },
        ],
      },
      {
        id: "pandas-build", kind: "build", title: "Build", estimatedMinutes: 32, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "pandas-quality-project", title: "Project: data-quality report", kind: "code", purpose: "project",
            skillIds: ["pandas-data-quality", "csv-cleaning"], introducedSkillIds: [],
            portfolioProjectId: "portfolio-data-pipeline",
            explanation: "Build the whole quality report yourself: solve(csv_text) takes CSV text with columns id,region,amount and returns a quality summary. Use pandas on the executed path. Count rows_in before cleaning; drop rows with blank/missing ids; rows_out and dropped follow. Fill missing amounts with the median (0.0 when the median is missing), rounded to 2; blank regions become \"unknown\". Group by region into by_region rows {\"region\", \"orders\", \"total\"} sorted by total DESC then region ASC. Return {\"rows_in\": int, \"rows_out\": int, \"dropped\": int, \"fill_report\": {\"amount\": \"median\", \"region\": \"unknown\"}, \"by_region\": [...]}. Non-string/blank input or missing id/region/amount columns return the zero report {\"rows_in\": 0, \"rows_out\": 0, \"dropped\": 0, \"fill_report\": {\"amount\": \"median\", \"region\": \"unknown\"}, \"by_region\": []}. This report becomes the quality gate of your data-pipeline portfolio project.",
            examples: [
              "Input: 'id,region,amount\\na,west,10.00\\nb,,5.00\\n,west,7.00\\nc,east,\\n'\nOutput: {\"rows_in\": 4, \"rows_out\": 3, \"dropped\": 1, \"fill_report\": {\"amount\": \"median\", \"region\": \"unknown\"}, \"by_region\": [{\"region\": \"west\", \"orders\": 1, \"total\": 10.0}, {\"region\": \"east\", \"orders\": 1, \"total\": 7.5}, {\"region\": \"unknown\", \"orders\": 1, \"total\": 5.0}]}",
              "Input: ''\nOutput: {\"rows_in\": 0, \"rows_out\": 0, \"dropped\": 0, \"fill_report\": {\"amount\": \"median\", \"region\": \"unknown\"}, \"by_region\": []}",
              "Input: 'id,amount\\na,1.00\\n' (no region column)\nOutput: the zero report.",
              "Note: the median of [10.00, 5.00] is 7.50, which fills row c's missing amount.",
            ],
            requirements: [
              "Define solve(csv_text). Non-string/blank input or missing id/region/amount columns return the zero report.",
              "Import pandas and use it on the executed path.",
              "rows_in counts input rows; rows_out counts rows after dropping blank ids; dropped is the difference.",
              "Fill missing amounts with the median (0.0 fallback), rounded to 2; blank regions become \"unknown\".",
              "by_region lists {\"region\", \"orders\", \"total\"} sorted by total DESC then region ASC.",
            ],
            hints: [
              "Compute rows_in right after read_csv, before any filtering.",
              "groupby(\"region\", as_index=False).agg(orders=(\"id\", \"count\"), total=(\"amount\", \"sum\")), then round totals.",
              "Sort with sort_values([\"total\", \"region\"], ascending=[False, True]).",
              "Return the zero report early for every invalid-input path — one shared dict shape.",
            ],
            variants: [codeVariant(
              "pandas-project-v1", "quality-report", "pandas-quality-project", "pandas-project-v1",
              "import io\nimport pandas as pd\n\nZERO = {\"rows_in\": 0, \"rows_out\": 0, \"dropped\": 0,\n        \"fill_report\": {\"amount\": \"median\", \"region\": \"unknown\"}, \"by_region\": []}\n\ndef solve(csv_text):\n    if type(csv_text) is not str or not csv_text.strip():\n        return dict(ZERO)\n    df = pd.read_csv(io.StringIO(csv_text))\n    for col in (\"id\", \"region\", \"amount\"):\n        if col not in df.columns:\n            return dict(ZERO)\n    # 1. rows_in; drop blank ids; rows_out/dropped.\n    # 2. Fill amounts/regions; group by region; sort total DESC, region ASC.\n    return dict(ZERO)\n",
              { "pandas-data-quality": ["concept-pandas", "sample", "missing", "shape"], "csv-cleaning": ["empty", "invalid"] },
            )],
          },
        ],
      },
      {
        id: "pandas-explain", kind: "explain", title: "Explain", estimatedMinutes: 5, advanceRule: "complete-tasks",
        tasks: [
          reflectionTask(
            "pandas-reflection", "Explain your fill choices", ["pandas-data-quality"],
            "Why does the report fill missing amounts with the median instead of the mean or zero, and when would you choose differently?",
            [
              "Explain what one huge outlier does to the mean versus the median.",
              "Explain when filling with 0.0 (the fallback) would mislead a reader of by_region totals.",
              "Give one input where dropping a row is better than filling it, and say which rule drops it.",
            ],
          ),
        ],
      },
    ],
  },
  {
    id: "sqlite-transactions",
    version: "1.0.0",
    title: "Query It Like You Mean It",
    summary: "Join customers to orders in SQLite, aggregate with GROUP BY, and write ledger entries inside real transactions.",
    prerequisites: ["pandas-missing-data"],
    introducedSkillIds: ["sqlite-analytics"],
    revisitedSkillIds: ["python-exceptions", "file-io", "data-structures"],
    estimatedMinutes: 50,
    stages: [
      {
        id: "sqlite-review", kind: "review", title: "Review", estimatedMinutes: 5, advanceRule: "attempt-review",
        tasks: [
          {
            id: "sqlite-review-files", title: "Recall: context managers close things", kind: "instruction", purpose: "instruction",
            skillIds: ["file-io"], introducedSkillIds: [],
            explanation: "Your crash-log scanner used with open(path) so the file always closes, even on error. Database connections want the same treatment: with sqlite3.connect(db_path) as conn commits on success and rolls back on exception — the transaction is atomic. The grader checks that sqlite3.connect is called through a context manager on the executed path; opening without with fails even if you close manually.",
            examples: [
              "with sqlite3.connect(db_path) as conn:\n    rows = conn.execute(\"SELECT ...\").fetchall()\n# commit on success, rollback on exception, always closed",
              "conn = sqlite3.connect(db_path)  # then conn.close() — NOT enough for the grader",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("sqlite-review-reading-v1", "sqlite-review")],
          },
        ],
      },
      {
        id: "sqlite-learn", kind: "learn", title: "Learn", estimatedMinutes: 14, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "sqlite-instruction", title: "JOIN, GROUP BY, and NULLs", kind: "instruction", purpose: "instruction",
            skillIds: ["sqlite-analytics"], introducedSkillIds: ["sqlite-analytics"],
            explanation: "Aggregation in SQL is GROUP BY plus a summary function. JOIN customers c to orders o ON o.customer_id = c.id — the ON clause is what pairs each order with its customer; ON 1 = 1 would pair every order with every customer and explode the totals. NULL regions need COALESCE(c.region, 'unknown') in both the SELECT and the GROUP BY, or NULL becomes its own silent group. ORDER BY total DESC, region ASC puts the biggest region first with alphabetical ties. Guard the path first: a non-string or missing file returns [] without touching sqlite3.",
            examples: [
              "SELECT COALESCE(c.region, 'unknown') AS region,\n       COUNT(o.id) AS orders,\n       ROUND(SUM(o.amount), 2) AS total\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nGROUP BY COALESCE(c.region, 'unknown')\nORDER BY total DESC, region ASC",
              "COALESCE must appear in GROUP BY too — grouping by the raw column splits 'unknown' rows into a NULL group.",
              "conn.row_factory = sqlite3.Row  # rows act like dicts: row[\"region\"]",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("sqlite-reading-v1", "sqlite-teaching")],
          },
          {
            id: "sqlite-agg-guided", title: "Guided practice: regional order totals", kind: "code", purpose: "guided-practice",
            skillIds: ["sqlite-analytics", "python-exceptions"], introducedSkillIds: [],
            explanation: "Write solve(db_path) that returns regional order aggregates. The database has customers(id, region) and orders(id, customer_id, amount). Open it with `with sqlite3.connect(db_path)` on the executed path. JOIN orders to customers on customer_id, map NULL regions to \"unknown\" with COALESCE, GROUP BY region, ORDER BY total DESC then region ASC. Return [{\"region\": str, \"orders\": int, \"total\": float}]. A non-string path, a missing file, or any sqlite error returns [] — never raise.",
            examples: [
              "customers: (1, 'west'), (2, None) — orders: (1, 10.00), (2, 5.00)\nOutput: [{\"region\": \"west\", \"orders\": 1, \"total\": 10.0}, {\"region\": \"unknown\", \"orders\": 1, \"total\": 5.0}]",
              "Input: 'missing.db'\nOutput: []",
              "Input: 42\nOutput: []",
            ],
            requirements: [
              "Define solve(db_path). Non-string paths and missing files return []; any sqlite error returns [].",
              "Open the database through a context manager: with sqlite3.connect(db_path).",
              "JOIN on o.customer_id = c.id; map NULL regions to \"unknown\" with COALESCE in SELECT and GROUP BY.",
              "ORDER BY total DESC, region ASC; return [{\"region\": str, \"orders\": int, \"total\": float}].",
            ],
            hints: [
              "Guard with type(db_path) is not str or not os.path.isfile(db_path) before connecting.",
              "Wrap the query in try/except Exception and return [] on failure.",
              "Use conn.row_factory = sqlite3.Row so rows support row[\"region\"].",
            ],
            variants: [codeVariant(
              "sqlite-agg-v1", "regional-totals", "sqlite-agg-challenge", "sqlite-agg-v1",
              "import os\nimport sqlite3\n\nQUERY = \"\"\"\nSELECT COALESCE(c.region, 'unknown') AS region,\n       COUNT(o.id) AS orders,\n       ROUND(SUM(o.amount), 2) AS total\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nGROUP BY COALESCE(c.region, 'unknown')\nORDER BY total DESC, region ASC\n\"\"\"\n\ndef solve(db_path):\n    if type(db_path) is not str or not os.path.isfile(db_path):\n        return []\n    # with sqlite3.connect(db_path) as conn: run QUERY, build the row dicts.\n    # On any exception return [].\n    return []\n",
              { "sqlite-analytics": ["concept-sqlite", "sample", "empty", "shape"], "python-exceptions": ["missing"] },
            )],
          },
        ],
      },
      {
        id: "sqlite-build", kind: "build", title: "Build", estimatedMinutes: 27, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "sqlite-ledger-project", title: "Project: ledger writer", kind: "code", purpose: "project",
            skillIds: ["sqlite-analytics", "file-io"], introducedSkillIds: [],
            explanation: "Build the whole writer yourself: solve(db_path, entries) inserts ledger entries inside a real transaction. The database already has customers(id) and ledger(customer_id, amount_cents, note) tables — do not create tables. Open with `with sqlite3.connect(db_path)` so writes commit; the grader reopens the file with a fresh connection and checks the rows are really there. Each entry is {\"customer_id\", \"amount\", \"note\"}: customer_id must be an exact int present in customers; amount must be a string holding a positive Decimal with at most two decimals (\"12.345\" rejected); note may be a string or omitted (NULL). Insert accepted rows as integer cents with a parameterized query. Return {\"inserted\": n, \"rejected\": n, \"total\": \"0.00\"} where total is the inserted sum formatted to two decimals. A bad db_path or non-list entries returns {\"inserted\": 0, \"rejected\": 0, \"total\": \"0.00\"}; any sqlite error returns the same zero report.",
            examples: [
              "customers: ids 1, 2 — entries: [{\"customer_id\": 1, \"amount\": \"10.50\", \"note\": \"refund\"}, {\"customer_id\": 9, \"amount\": \"5.00\"}, {\"customer_id\": 2, \"amount\": \"0.10\"}]\nOutput: {\"inserted\": 2, \"rejected\": 1, \"total\": \"10.60\"} — and ledger holds (1, 1050, 'refund'), (2, 10, NULL).",
              "Input: (\"missing.db\", [])\nOutput: {\"inserted\": 0, \"rejected\": 0, \"total\": \"0.00\"}",
              "Entry {\"customer_id\": 1, \"amount\": \"12.345\"} is rejected: three decimals are not exact cents.",
              "Input: (\"shop.db\", \"nope\")\nOutput: {\"inserted\": 0, \"rejected\": 0, \"total\": \"0.00\"}",
            ],
            requirements: [
              "Define solve(db_path, entries). Bad db_path or non-list entries returns the zero report; any sqlite error returns the zero report.",
              "Open with `with sqlite3.connect(db_path)`; inserted rows must be visible to a fresh connection.",
              "Validate each entry: exact-int customer_id present in customers; amount a positive string with at most two decimals; note a string or absent.",
              "Insert accepted rows into ledger as integer cents with a parameterized query; count inserted/rejected; total formatted \"0.00\".",
            ],
            hints: [
              "Read valid ids once: {row[0] for row in conn.execute(\"SELECT id FROM customers\").fetchall()}.",
              "Convert amounts: Decimal(text); require finite, > 0, and (amount * 100) == its integral value; cents = int(amount * 100).",
              "INSERT INTO ledger (customer_id, amount_cents, note) VALUES (?, ?, ?) — never format values into SQL.",
              "Accumulate total_cents as an int; format with (Decimal(total_cents) / 100).quantize(Decimal(\"0.01\")).",
            ],
            variants: [codeVariant(
              "sqlite-project-v1", "ledger-writer", "sqlite-project-challenge", "sqlite-project-v1",
              "import os\nimport sqlite3\nfrom decimal import Decimal, InvalidOperation\n\ndef to_cents(value):\n    # Positive exact-cent string -> int cents, else None.\n    return None\n\ndef solve(db_path, entries):\n    zero = {\"inserted\": 0, \"rejected\": 0, \"total\": \"0.00\"}\n    if type(db_path) is not str or not os.path.isfile(db_path):\n        return dict(zero)\n    if type(entries) is not list:\n        return dict(zero)\n    # with sqlite3.connect(db_path) as conn: validate each entry,\n    # INSERT accepted rows as cents, count, total.\n    # On exception return the zero report.\n    return dict(zero)\n",
              { "sqlite-analytics": ["concept-sqlite", "concept-transaction", "sample", "committed", "shape"], "file-io": ["empty"] },
            )],
          },
        ],
      },
      {
        id: "sqlite-explain", kind: "explain", title: "Explain", estimatedMinutes: 4, advanceRule: "complete-tasks",
        tasks: [
          reflectionTask(
            "sqlite-reflection", "Explain your transaction", ["sqlite-analytics"],
            "Why does the ledger writer use a context manager instead of calling commit() manually, and what could go wrong with manual commits?",
            [
              "Explain what happens to the INSERTs if an exception fires mid-loop under with versus manual commit.",
              "Explain why the grader checks the rows from a fresh connection.",
              "Give one entry your writer rejects and the exact rule that rejects it.",
            ],
          ),
        ],
      },
    ],
  },
  {
    id: "money-reconciliation",
    version: "1.0.0",
    title: "Every Cent Accounted For",
    summary: "Reconcile credit/debit ledgers with exact Decimal arithmetic and flag anomalies in a pandas pipeline.",
    prerequisites: ["sqlite-transactions"],
    introducedSkillIds: [],
    revisitedSkillIds: ["financial-data", "python-functions", "pandas-data-quality", "sqlite-analytics"],
    estimatedMinutes: 45,
    stages: [
      {
        id: "money-review", kind: "review", title: "Review", estimatedMinutes: 4, advanceRule: "attempt-review",
        tasks: [
          {
            id: "money-review-decimal", title: "Recall: exact money or nothing", kind: "instruction", purpose: "instruction",
            skillIds: ["financial-data"], introducedSkillIds: [],
            explanation: "Your ledger writer stored cents as integers because floats cannot represent most decimals exactly: 0.1 + 0.2 is 0.30000000000000004. Reconciliation has the same rule at a bigger scale — sum credits and debits as Decimal, compare the net to zero exactly, and never let a float touch the totals. Amounts arrive as text; parse with Decimal(text), require finite and positive, and require at most two decimals so \"12.345\" cannot sneak in.",
            examples: [
              "0.1 + 0.2  # 0.30000000000000004 — floats lie about money",
              "Decimal(\"0.1\") + Decimal(\"0.2\") == Decimal(\"0.3\")  # True — Decimal keeps the promise",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("money-review-reading-v1", "money-review")],
          },
        ],
      },
      {
        id: "money-learn", kind: "learn", title: "Learn", estimatedMinutes: 14, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "money-instruction", title: "Balanced means net zero", kind: "instruction", purpose: "instruction",
            skillIds: ["financial-data"], introducedSkillIds: [],
            explanation: "A reconciled ledger is simple: every transaction is {\"id\", \"amount\", \"type\"} where type is \"credit\" or \"debit\". Credits add, debits subtract; the ledger is balanced when the net is exactly zero. Three things make a transaction anomalous instead of countable: a duplicate id (seen before), an amount that is not a positive exact-cent string, or a type outside credit/debit. Anomalies are reported by id — the report names them, it does not silently drop them. The total is always formatted \"0.00\", even when zero.",
            examples: [
              "[{\"id\": \"a\", \"amount\": \"10.00\", \"type\": \"credit\"}, {\"id\": \"b\", \"amount\": \"4.00\", \"type\": \"debit\"}]\n# total = \"6.00\", balanced = False",
              "[{\"id\": \"a\", \"amount\": \"10.00\", \"type\": \"credit\"}, {\"id\": \"a\", \"amount\": \"10.00\", \"type\": \"credit\"}]\n# second \"a\" is a duplicate -> anomalies [\"a\"], total = \"10.00\"",
              "[{\"id\": \"c\", \"amount\": \"12.345\", \"type\": \"credit\"}]  # three decimals -> anomalies [\"c\"]",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("money-reading-v1", "money-teaching")],
          },
          {
            id: "money-recon-guided", title: "Guided practice: reconcile a ledger", kind: "code", purpose: "guided-practice",
            skillIds: ["financial-data", "python-functions"], introducedSkillIds: [],
            explanation: "Write solve(transactions) that reconciles a list of {\"id\", \"amount\", \"type\"} dicts. Parse amounts with Decimal: they must be strings holding finite, positive values with at most two decimals. type must be \"credit\" or \"debit\"; ids must be strings and unique — a repeated id is anomalous. Append the id of every anomalous entry to anomalies. Net = credits minus debits as Decimal; balanced is (net == 0); total formatted \"0.00\". Non-list input returns {\"balanced\": True, \"total\": \"0.00\", \"anomalies\": []}.",
            examples: [
              "Input: [{\"id\": \"a\", \"amount\": \"10.00\", \"type\": \"credit\"}, {\"id\": \"b\", \"amount\": \"10.00\", \"type\": \"debit\"}]\nOutput: {\"balanced\": True, \"total\": \"0.00\", \"anomalies\": []}",
              "Input: [{\"id\": \"a\", \"amount\": \"10.00\", \"type\": \"credit\"}, {\"id\": \"a\", \"amount\": \"1.00\", \"type\": \"credit\"}, {\"id\": \"c\", \"amount\": \"x\", \"type\": \"debit\"}]\nOutput: {\"balanced\": False, \"total\": \"10.00\", \"anomalies\": [\"a\", \"c\"]}",
              "Input: \"nope\"\nOutput: {\"balanced\": True, \"total\": \"0.00\", \"anomalies\": []}",
            ],
            requirements: [
              "Define solve(transactions). Non-list input returns the zero report; never raise.",
              "Parse amounts with Decimal; require finite, positive, at most two decimals.",
              "Treat duplicate ids, bad amounts, and bad types as anomalies; append each anomalous id.",
              "total = credits minus debits formatted \"0.00\"; balanced is True only when the net is exactly zero.",
            ],
            hints: [
              "Write parse_amount(value) returning a Decimal or None; check amount != amount.quantize(Decimal(\"0.01\")).",
              "Keep a seen set of ids; check membership before adding.",
              "Accumulate net as Decimal(\"0\"); format with str(net.quantize(Decimal(\"0.01\"))).",
            ],
            variants: [codeVariant(
              "money-recon-v1", "ledger-reconcile", "money-recon-challenge", "money-recon-v1",
              "from decimal import Decimal, InvalidOperation\n\ndef parse_amount(value):\n    # Positive exact-cent string -> Decimal, else None.\n    return None\n\ndef solve(transactions):\n    report = {\"balanced\": True, \"total\": \"0.00\", \"anomalies\": []}\n    if type(transactions) is not list:\n        return dict(report)\n    # Per entry: validate id/amount/type, track seen ids,\n    # accumulate the Decimal net, flag anomalies.\n    return report\n",
              { "financial-data": ["sample", "invalid", "anomaly", "shape"], "python-functions": ["empty"] },
            )],
          },
          {
            id: "sqlite-rollup-retrieval", title: "Retrieval: regional ledger rollup", kind: "code", purpose: "retrieval",
            skillIds: ["sqlite-analytics"], introducedSkillIds: [],
            explanation: "A finance dashboard needs the same regional rollup you built for orders, now over a ledger table. Without opening your old solution, recall the pattern: guard the path, open with a context manager, JOIN on the key, COALESCE the NULLs, GROUP BY, ORDER BY. This short retrieval is allowed to fail; its purpose is to find what needs repair.",
            examples: [
              "Same contract as regional order totals: solve(db_path) -> [{\"region\", \"orders\", \"total\"}], NULL regions become \"unknown\".",
            ],
            requirements: [
              "Define solve(db_path). Non-string paths, missing files, and sqlite errors return [].",
              "Open with `with sqlite3.connect(db_path)` on the executed path.",
              "JOIN on the customer key; COALESCE NULL regions to \"unknown\"; ORDER BY total DESC, region ASC.",
            ],
            hints: [
              "Guard the path with os.path.isfile before connecting.",
              "COALESCE belongs in both SELECT and GROUP BY.",
            ],
            variants: [codeVariant(
              "ledger-rollup-v1", "ledger-rollup", "sqlite-agg-challenge", "sqlite-agg-v1",
              "import os\nimport sqlite3\n\ndef solve(db_path):\n    if type(db_path) is not str or not os.path.isfile(db_path):\n        return []\n    # Context manager, JOIN, COALESCE, GROUP BY, ORDER BY.\n    return []\n",
              { "sqlite-analytics": ["concept-sqlite", "sample", "empty", "missing", "shape"] },
            )],
          },
        ],
      },
      {
        id: "money-build", kind: "build", title: "Build", estimatedMinutes: 23, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "money-csv-project", title: "Project: anomaly scan over CSV", kind: "code", purpose: "project",
            skillIds: ["financial-data", "pandas-data-quality"], introducedSkillIds: [],
            portfolioProjectId: "portfolio-money-reconciliation",
            explanation: "Build the whole scanner yourself: solve(csv_text) reads CSV text with columns id,amount,type using pandas (dtype=str, keep_default_na=False) on the executed path, then reconciles with the exact rules from guided practice. rows counts every data row. Validation is identical: amount must be a positive exact-cent string, type credit/debit, ids unique — anomalous ids go to flagged (rows with blank ids are skipped silently). net is credits minus debits formatted \"0.00\". Non-string/blank input or missing id/amount/type columns return {\"rows\": 0, \"flagged\": [], \"net\": \"0.00\"}. This scanner becomes the anomaly detector of your money-reconciliation portfolio project.",
            examples: [
              "Input: 'id,amount,type\\na,10.00,credit\\nb,4.00,debit\\na,1.00,credit\\nc,x,debit\\n'\nOutput: {\"rows\": 4, \"flagged\": [\"a\", \"c\"], \"net\": \"6.00\"}",
              "Input: ''\nOutput: {\"rows\": 0, \"flagged\": [], \"net\": \"0.00\"}",
              "Input: 'id,amount\\na,1.00\\n' (no type column)\nOutput: {\"rows\": 0, \"flagged\": [], \"net\": \"0.00\"}",
              "A second occurrence of id \"a\" is flagged even though its amount is valid — duplicates are anomalies.",
            ],
            requirements: [
              "Define solve(csv_text). Non-string/blank input or missing id/amount/type columns return the zero report.",
              "Read the CSV with pandas on the executed path; rows counts every data row.",
              "Apply the exact reconciliation rules: positive exact-cent Decimal amounts, credit/debit only, unique ids; flag every anomalous id.",
              "net formatted \"0.00\"; blank-id rows are skipped without flagging.",
            ],
            hints: [
              "pd.read_csv(io.StringIO(csv_text), dtype=str, keep_default_na=False) keeps everything as text.",
              "Strip row[\"id\"] and row[\"type\"]; reuse a parse_amount helper from guided practice.",
              "Iterate df.iterrows(); track seen ids in a set.",
              "Accumulate net as Decimal; format at the end.",
            ],
            variants: [codeVariant(
              "money-project-v1", "csv-anomaly-scan", "money-project-challenge", "money-project-v1",
              "import io\nfrom decimal import Decimal, InvalidOperation\nimport pandas as pd\n\ndef parse_amount(value):\n    # Positive exact-cent string -> Decimal, else None.\n    return None\n\ndef solve(csv_text):\n    report = {\"rows\": 0, \"flagged\": [], \"net\": \"0.00\"}\n    if type(csv_text) is not str or not csv_text.strip():\n        return report\n    # 1. pd.read_csv; require id/amount/type columns.\n    # 2. Per row: validate, track seen, accumulate Decimal net, flag anomalies.\n    return report\n",
              { "financial-data": ["sample", "invalid", "anomaly", "shape"], "pandas-data-quality": ["concept-pandas", "empty"] },
            )],
          },
        ],
      },
      {
        id: "money-explain", kind: "explain", title: "Explain", estimatedMinutes: 4, advanceRule: "complete-tasks",
        tasks: [
          reflectionTask(
            "money-reflection", "Explain your anomaly policy", ["financial-data"],
            "Why does the scanner flag duplicate ids instead of counting them twice, and what real fraud does that rule catch?",
            [
              "Explain what double-counting a duplicated credit would do to the net.",
              "Explain why \"12.345\" is flagged rather than rounded to cents.",
              "Give one CSV row your scanner flags and the exact rule that flags it.",
            ],
          ),
        ],
      },
    ],
  },
  {
    id: "http-resilience",
    version: "1.0.0",
    title: "Clients That Survive the Internet",
    summary: "Retry 429s with Retry-After, back off from 500s, and walk paginated APIs without leaving your allowlist.",
    prerequisites: ["money-reconciliation"],
    introducedSkillIds: ["http-reliability"],
    revisitedSkillIds: ["json-validation", "python-exceptions"],
    estimatedMinutes: 50,
    stages: [
      {
        id: "http-review", kind: "review", title: "Review", estimatedMinutes: 4, advanceRule: "attempt-review",
        tasks: [
          {
            id: "http-review-json", title: "Recall: validate the body", kind: "instruction", purpose: "instruction",
            skillIds: ["json-validation"], introducedSkillIds: [],
            explanation: "Every HTTP response ends where your JSON mission began: a body of text that may or may not be valid JSON. The pagination client you build today does json.loads on each page body and requires a dict with an items list — a malformed page stops the walk with ok False. Status codes decide whether you even look at the body: 2xx means read it, 429/5xx mean wait and retry, anything else means stop.",
            examples: [
              "200 + '{\"items\": [1], \"next\": \"/p2\"}' -> read the items, follow next.",
              "200 + 'not json' -> stop: the page is unusable, ok stays False.",
              "404 -> stop immediately: retrying a client error never helps.",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("http-review-reading-v1", "http-review")],
          },
        ],
      },
      {
        id: "http-learn", kind: "learn", title: "Learn", estimatedMinutes: 16, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "http-instruction", title: "Retry with a budget", kind: "instruction", purpose: "instruction",
            skillIds: ["http-reliability"], introducedSkillIds: ["http-reliability"],
            explanation: "A resilient client retries only what might succeed. 200-299: done, return the body. 429 (rate limited): the server tells you how long to wait in the Retry-After header — sleep that long, capped at 60 seconds so a malicious header cannot stall you forever; a missing or unparsable header means 1 second. 500-599: the server is sick; back off 1 second after the first failure, 2 seconds after the second. Anything else (like 404): return immediately, no retry — the request itself is wrong. Three attempts maximum; then return the last response. The transport is injected as transport(\"GET\", url) returning (status, headers, body), and sleep is injected too — no real network, no real waiting, fully deterministic tests.",
            examples: [
              "429 with Retry-After: 120 -> sleep(60.0), then retry (capped).",
              "500 -> sleep(1.0) -> 500 -> sleep(2.0) -> 500 -> return {\"ok\": False, \"attempts\": 3}.",
              "404 -> return {\"ok\": False, \"status\": 404, \"attempts\": 1} with no sleep at all.",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("http-reading-v1", "http-teaching")],
          },
          {
            id: "http-client-guided", title: "Guided practice: retrying client", kind: "code", purpose: "guided-practice",
            skillIds: ["http-reliability", "python-exceptions"], introducedSkillIds: [],
            explanation: "Write solve(transport, url, sleep) implementing the retry policy. Call transport(\"GET\", url); it returns (status, headers, body). On 200-299 return {\"ok\": True, \"status\", \"body\", \"attempts\"} at once. On 429 (attempts left) sleep min(float(Retry-After), 60.0) — 1.0 when the header is missing or unparsable — then retry. On 500-599 (attempts left) sleep 1.0 after the first failure and 2.0 after the second, then retry. Other statuses return {\"ok\": False, ...} with no retry. Three attempts maximum; always return the last response with its attempt count.",
            examples: [
              "transport -> [(429, {\"Retry-After\": \"2\"}, \"\"), (200, {}, \"hi\")]\nOutput: {\"ok\": True, \"status\": 200, \"body\": \"hi\", \"attempts\": 2} — and sleep was called once with 2.0.",
              "transport -> [(500, {}, \"\"), (500, {}, \"\"), (500, {}, \"\")]\nOutput: {\"ok\": False, \"status\": 500, \"body\": \"\", \"attempts\": 3} — sleeps of 1.0 then 2.0.",
              "transport -> [(404, {}, \"nope\")]\nOutput: {\"ok\": False, \"status\": 404, \"body\": \"nope\", \"attempts\": 1} — no sleep.",
            ],
            requirements: [
              "Define solve(transport, url, sleep). Call transport(\"GET\", url); it returns (status, headers, body).",
              "200-299 returns {\"ok\": True, \"status\", \"body\", \"attempts\"} immediately.",
              "429 retries after sleeping min(float(Retry-After), 60.0), defaulting to 1.0.",
              "500-599 retries after sleeping 1.0 then 2.0; other statuses never retry.",
              "Three attempts maximum; return the last response with the attempt count.",
            ],
            hints: [
              "Loop while attempts < 3; increment first, then call the transport.",
              "Read Retry-After case-insensitively: key.lower() == \"retry-after\".",
              "The 5xx sleep is float(attempts): 1.0 after attempt one, 2.0 after attempt two.",
            ],
            variants: [codeVariant(
              "http-client-v1", "retrying-get", "http-client-challenge", "http-client-v1",
              "def retry_delay(headers):\n    # Retry-After seconds capped at 60.0, else 1.0.\n    return 1.0\n\ndef solve(transport, url, sleep):\n    attempts = 0\n    status, headers, body = 0, {}, \"\"\n    # Up to 3 attempts: 2xx -> ok; 429 -> sleep(retry_delay) ; 5xx -> sleep(attempts); else stop.\n    return {\"ok\": False, \"status\": status, \"body\": body, \"attempts\": attempts}\n",
              { "http-reliability": ["boundary-199", "boundary-200", "boundary-299", "boundary-300", "retry-after", "retries", "no-retry-client-error", "exhausted"], "python-exceptions": ["exhausted"] },
            )],
          },
        ],
      },
      {
        id: "http-build", kind: "build", title: "Build", estimatedMinutes: 26, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "http-pagination-project", title: "Project: paginated API walker", kind: "code", purpose: "project",
            skillIds: ["http-reliability", "json-validation"], introducedSkillIds: [],
            portfolioProjectId: "portfolio-api-normalization",
            explanation: "Build the whole walker yourself: solve(transport, base_url, sleep) collects every page of a paginated API. Fetch each page with the guided retry policy (429 honors Retry-After capped at 60; 500s back off 1s then 2s; 3 attempts max). A page that never recovers stops the walk: return {\"items\": [...], \"pages\": n, \"ok\": False}. Parse each body with json.loads; require a dict with an items list — anything else stops the walk with ok False. Follow the next cursor ONLY when it is a string starting with \"/\"; an absolute URL or anything else ends pagination successfully. Guard against cycles and stop after 10 pages. Bad inputs (non-callable transport/sleep, non-string base_url) return {\"items\": [], \"pages\": 0, \"ok\": False}. This walker becomes the fetcher of your API-normalization portfolio project.",
            examples: [
              "Pages: {\"items\": [1], \"next\": \"/p2\"} -> {\"items\": [2], \"next\": null}\nOutput: {\"items\": [1, 2], \"pages\": 2, \"ok\": True}",
              "Page 2 returns {\"items\": [2], \"next\": \"https://other.dev/p3\"}\nOutput: {\"items\": [1, 2], \"pages\": 2, \"ok\": True} — absolute next ends the walk cleanly.",
              "Page 1 fails 500 three times\nOutput: {\"items\": [], \"pages\": 0, \"ok\": False}",
              "Eleven pages of next cursors -> stops at 10 with ok True.",
            ],
            requirements: [
              "Define solve(transport, base_url, sleep). Bad inputs return {\"items\": [], \"pages\": 0, \"ok\": False}.",
              "Fetch each page with the retry policy: 429 sleeps Retry-After (cap 60), 5xx backs off 1s/2s, 3 attempts max.",
              "Unrecoverable or malformed pages stop the walk with ok False and the items collected so far.",
              "Follow next only when it is a string starting with \"/\"; anything else ends pagination with ok True.",
              "Stop after 10 pages; break on repeated URLs.",
            ],
            hints: [
              "Write request_with_retry(transport, url, sleep) returning (\"ok\"|\"error\", status, body).",
              "Keep a seen set of URLs; break the loop when a URL repeats.",
              "Extend items only after json.loads gives a dict with a list items field.",
              "Set ok True only when the loop ends by exhausting next or hitting the page cap.",
            ],
            variants: [codeVariant(
              "http-project-v1", "page-walker", "http-project-challenge", "http-project-v1",
              "import json as json_module\n\ndef request_with_retry(transport, url, sleep):\n    # (\"ok\", status, body) or (\"error\", status, body) after up to 3 attempts.\n    return (\"error\", 0, \"\")\n\ndef solve(transport, base_url, sleep):\n    result = {\"items\": [], \"pages\": 0, \"ok\": False}\n    if not callable(transport) or type(base_url) is not str or not callable(sleep):\n        return result\n    # Walk pages: retry, parse, extend, follow \"/\"-prefixed next; cap at 10.\n    return result\n",
              { "http-reliability": ["pagination", "retries", "page-limit", "unrecoverable"], "json-validation": ["shape"] },
            )],
          },
        ],
      },
      {
        id: "http-explain", kind: "explain", title: "Explain", estimatedMinutes: 4, advanceRule: "complete-tasks",
        tasks: [
          reflectionTask(
            "http-reflection", "Explain your retry budget", ["http-reliability"],
            "Why does the walker retry 429 and 500 but never 404, and why is Retry-After capped at 60 seconds?",
            [
              "Explain the difference between a failure that waiting can fix and one it cannot.",
              "Explain what an uncapped Retry-After would let a malicious server do.",
              "Give one walk where following an absolute next URL would be a security problem.",
            ],
          ),
        ],
      },
    ],
  },
  {
    id: "llm-guardrails",
    version: "1.0.0",
    title: "Trust, But Validate the Model",
    summary: "Put deterministic guardrails around LLM output: schema validation, fixed field order, and bounded retries.",
    prerequisites: ["http-resilience"],
    introducedSkillIds: ["llm-output-validation"],
    revisitedSkillIds: ["json-validation", "python-exceptions", "http-reliability"],
    estimatedMinutes: 40,
    stages: [
      {
        id: "llm-review", kind: "review", title: "Review", estimatedMinutes: 4, advanceRule: "attempt-review",
        tasks: [
          {
            id: "llm-review-validation", title: "Recall: schemas are contracts", kind: "instruction", purpose: "instruction",
            skillIds: ["json-validation"], introducedSkillIds: [],
            explanation: "Your API mission validated every layer of a response envelope; LLM output needs the same treatment with one extra twist — the model is nondeterministic, so the validator must be deterministic. Same input text always yields the same verdict: fixed field order, exact type checks, every error collected. The guardrail turns 'the model said something' into 'the model said a valid profile' or a precise list of what is wrong.",
            examples: [
              "Nondeterministic: the model may return fields in any order, with any spacing.",
              "Deterministic: the guard checks name, age, email in that fixed order and reports [\"bad_age\"] every time for the same text.",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("llm-review-reading-v1", "llm-review")],
          },
        ],
      },
      {
        id: "llm-learn", kind: "learn", title: "Learn", estimatedMinutes: 13, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "llm-instruction", title: "Guardrails are pure functions", kind: "instruction", purpose: "instruction",
            skillIds: ["llm-output-validation"], introducedSkillIds: ["llm-output-validation"],
            explanation: "The guard is a pure function: solve(raw_text) -> {\"ok\", \"data\", \"errors\"}. No network, no model calls, no randomness — the grader can test it exhaustively. Steps: reject non-strings as invalid_json; json.loads (failure -> invalid_json); require a dict (else not_an_object). Then check the profile schema in FIXED order (name, age, email) — iterating the input's keys would make error order depend on the model, which is nondeterministic. name: non-blank str; age: exact int 0-120 (bool rejected); email: str containing '@' after strip. Missing field -> \"missing_<field>\"; bad value -> \"bad_<field>\"; collect ALL errors. Success returns the stripped profile and [].",
            examples: [
              "'{\"name\": \" Ada \", \"age\": 36, \"email\": \"a@x.com\"}'\n# {\"ok\": True, \"data\": {\"name\": \"Ada\", \"age\": 36, \"email\": \"a@x.com\"}, \"errors\": []}",
              "'{\"age\": -1, \"name\": \"\"}'\n# {\"ok\": False, \"data\": None, \"errors\": [\"bad_name\", \"bad_age\", \"missing_email\"]} — fixed order, all errors",
              "'[1, 2]'  # valid JSON, not an object -> not_an_object",
            ],
            requirements: ["Read the examples and acknowledge the lesson. Reading records exposure only; it does not demonstrate a skill."],
            hints: [],
            variants: [readingVariant("llm-reading-v1", "llm-teaching")],
          },
          {
            id: "llm-guard-guided", title: "Guided practice: profile guard", kind: "code", purpose: "guided-practice",
            skillIds: ["llm-output-validation", "json-validation"], introducedSkillIds: [],
            explanation: "Write solve(raw_text) implementing the profile guardrail. Non-string input -> {\"ok\": False, \"data\": None, \"errors\": [\"invalid_json\"]}. json.loads failure -> invalid_json; non-dict -> not_an_object. Validate name/age/email in that fixed schema order: name must be a non-blank str; age an exact int (bool rejected) 0-120; email a str containing '@' after stripping. A missing (None) field reports \"missing_<field>\"; a present-but-bad value reports \"bad_<field>\"; collect every error. Success -> {\"ok\": True, \"data\": {\"name\": stripped, \"age\": int, \"email\": stripped}, \"errors\": []}.",
            examples: [
              "Input: '{\"name\": \" Ada \", \"age\": 36, \"email\": \"a@x.com\"}'\nOutput: {\"ok\": True, \"data\": {\"name\": \"Ada\", \"age\": 36, \"email\": \"a@x.com\"}, \"errors\": []}",
              "Input: '{\"age\": True, \"email\": \"nope\"}'\nOutput: {\"ok\": False, \"data\": None, \"errors\": [\"missing_name\", \"bad_age\", \"bad_email\"]}",
              "Input: '{\"name\": \"Bo\", \"age\": 40, \"email\": \"b@x.com\", \"extra\": 1}'\nOutput ok True — extra fields are ignored.",
            ],
            requirements: [
              "Define solve(raw_text). Non-string input and JSON syntax failures return errors [\"invalid_json\"].",
              "Non-dict JSON returns errors [\"not_an_object\"].",
              "Validate name, age, email in fixed schema order with exact type checks; collect ALL errors as missing_<field>/bad_<field>.",
              "Success returns the stripped profile with errors [].",
            ],
            hints: [
              "Write check_name/check_age/check_email helpers returning None or the error string.",
              "Loop over (\"name\", \"age\", \"email\") — never over data's keys.",
              "Distinguish missing (value is None) from bad before validating the value.",
            ],
            variants: [codeVariant(
              "llm-guard-v1", "profile-guard", "llm-guard-challenge", "llm-guard-v1",
              "import json\n\nFIELDS = (\"name\", \"age\", \"email\")\n\ndef check_name(value):\n    # None when valid, else \"missing_name\"/\"bad_name\".\n    return None\n\ndef check_age(value):\n    return None\n\ndef check_email(value):\n    return None\n\ndef solve(raw_text):\n    if type(raw_text) is not str:\n        return {\"ok\": False, \"data\": None, \"errors\": [\"invalid_json\"]}\n    # json.loads; require dict; run the checks in FIELDS order; collect errors.\n    return {\"ok\": False, \"data\": None, \"errors\": [\"invalid_json\"]}\n",
              { "llm-output-validation": ["sample", "schema", "deterministic", "shape"], "json-validation": ["empty", "invalid"] },
            )],
          },
          {
            id: "model-retry-retrieval", title: "Retrieval: retry a flaky model endpoint", kind: "code", purpose: "retrieval",
            skillIds: ["http-reliability"], introducedSkillIds: [],
            explanation: "Model endpoints are flaky HTTP APIs: 429s when you exceed your token quota, 500s when the provider hiccups. Without opening your old solution, recall the retry policy — which statuses retry, how long each sleep is, when to stop. This short retrieval is allowed to fail; its purpose is to find what needs repair.",
            examples: [
              "Same contract as the retrying client: solve(transport, url, sleep) -> {\"ok\", \"status\", \"body\", \"attempts\"}.",
            ],
            requirements: [
              "Define solve(transport, url, sleep) with the injected fake transport.",
              "200-299 returns ok True at once; 429 sleeps Retry-After (cap 60); 500s back off 1s then 2s; other statuses never retry.",
              "Three attempts maximum; return the last response.",
            ],
            hints: [
              "429's sleep defaults to 1.0 when the header is missing or unparsable.",
              "The 5xx sleep equals the attempt number as a float.",
            ],
            variants: [codeVariant(
              "model-retry-v1", "model-endpoint", "http-client-challenge", "http-client-v1",
              "def solve(transport, url, sleep):\n    # Same retry policy as the guided client.\n    return {\"ok\": False, \"status\": 0, \"body\": \"\", \"attempts\": 0}\n",
              { "http-reliability": ["retry-after", "retries", "exhausted", "boundary-200"] },
            )],
          },
        ],
      },
      {
        id: "llm-build", kind: "build", title: "Build", estimatedMinutes: 19, advanceRule: "complete-tasks",
        tasks: [
          {
            id: "llm-pipeline-project", title: "Project: guarded model pipeline", kind: "code", purpose: "project",
            skillIds: ["llm-output-validation", "python-exceptions"], introducedSkillIds: [],
            portfolioProjectId: "portfolio-llm-guardrails",
            explanation: "Build the whole pipeline yourself: solve(model, prompt) calls an injected fake model and returns the first valid profile. model(prompt, attempts) returns raw text; validate each response with the profile guardrail (fixed field order, exact types, all errors collected). A non-callable model or non-string prompt returns {\"ok\": False, \"data\": None, \"errors\": [\"bad_input\"], \"attempts\": 0}. Retry up to 3 attempts: a model exception counts as a failed attempt with errors [\"model_error\"]. The first valid payload wins -> {\"ok\": True, \"data\": profile, \"errors\": [], \"attempts\": n}. If all 3 attempts fail, return {\"ok\": False, \"data\": None, \"errors\": <last attempt's errors>, \"attempts\": 3}. The model is injected — no real API calls, fully deterministic. This pipeline becomes the core of your LLM-guardrails portfolio project.",
            examples: [
              "model returns ['oops', '{\"name\": \"Ada\", \"age\": 36, \"email\": \"a@x.com\"}']\nOutput: {\"ok\": True, \"data\": {\"name\": \"Ada\", \"age\": 36, \"email\": \"a@x.com\"}, \"errors\": [], \"attempts\": 2}",
              "model raises on every call\nOutput: {\"ok\": False, \"data\": None, \"errors\": [\"model_error\"], \"attempts\": 3}",
              "model returns ['{\"age\": 1}', '{\"age\": 2}', '{\"age\": 3}']\nOutput: {\"ok\": False, \"data\": None, \"errors\": [\"missing_name\", \"missing_email\"], \"attempts\": 3}",
              "Input: (None, \"hi\")\nOutput: {\"ok\": False, \"data\": None, \"errors\": [\"bad_input\"], \"attempts\": 0}",
            ],
            requirements: [
              "Define solve(model, prompt). Non-callable model or non-string prompt returns bad_input with 0 attempts.",
              "Call model(prompt, attempts) and validate each response with the profile guardrail.",
              "Retry up to 3 attempts; model exceptions count as failed attempts with errors [\"model_error\"].",
              "First valid payload wins with its attempt count; total failure returns the last errors with attempts 3.",
            ],
            hints: [
              "Write validate_text(raw_text) reusing your guided guardrail logic.",
              "Loop attempts 1..3: try model(prompt, attempts), except Exception -> [\"model_error\"], continue.",
              "Keep last_errors from each failed validation; return them after the loop.",
              "Return immediately on the first verdict with ok True.",
            ],
            variants: [codeVariant(
              "llm-project-v1", "guarded-pipeline", "llm-project-challenge", "llm-project-v1",
              "import json\n\ndef validate_text(raw_text):\n    # Profile guardrail: {\"ok\", \"data\", \"errors\"}.\n    return {\"ok\": False, \"data\": None, \"errors\": [\"invalid_json\"]}\n\ndef solve(model, prompt):\n    if not callable(model) or type(prompt) is not str:\n        return {\"ok\": False, \"data\": None, \"errors\": [\"bad_input\"], \"attempts\": 0}\n    # Up to 3 attempts: model(prompt, attempts), validate, first ok wins.\n    return {\"ok\": False, \"data\": None, \"errors\": [\"no_response\"], \"attempts\": 0}\n",
              { "llm-output-validation": ["passthrough", "retry", "invalid-body", "exhausted"], "python-exceptions": ["shape"] },
            )],
          },
        ],
      },
      {
        id: "llm-explain", kind: "explain", title: "Explain", estimatedMinutes: 4, advanceRule: "complete-tasks",
        tasks: [
          reflectionTask(
            "llm-reflection", "Explain your determinism", ["llm-output-validation"],
            "Why does the guardrail check fields in a fixed order instead of the model's order, and what breaks if retries are unbounded?",
            [
              "Explain how input-order iteration would make the same text produce different error lists.",
              "Explain why the pipeline stops at 3 attempts instead of retrying forever.",
              "Give one model output your guardrail rejects and the exact error list it produces.",
            ],
          ),
        ],
      },
    ],
  },
];

/** Retrieval practice for promoted skills, in new contexts. Merged with the
 *  existing reviewTasks in curriculum/index.ts. */
export const MISSION_2_REVIEW_TASKS: MissionTask[] = [
  {
    id: "traceback-retrieval", title: "Parse a deployment traceback", kind: "code", purpose: "retrieval",
    skillIds: ["python-exceptions"], introducedSkillIds: [],
    explanation: "A deploy failed with a chained traceback: a config error caused a startup crash. Without opening your old solution, recall the parser: last block wins, frames in call order, SyntaxError frames carry an empty function. This short retrieval is allowed to fail; its purpose is to find what needs repair.",
    examples: [
      "Input: a chained traceback ending in 'RuntimeError: startup failed' with two frames\nOutput: {\"type\": \"RuntimeError\", \"message\": \"startup failed\", \"frames\": [...]}",
    ],
    requirements: [
      "Define solve(text). Non-string input returns the all-empty shape.",
      "Parse only the last traceback block; frames carry file, integer line, and function.",
    ],
    hints: ["Slice from the last 'Traceback (most recent call last):' header."],
    variants: [codeVariant(
      "traceback-retrieval-v1", "deploy-traceback", "traceback-challenge", "traceback-v1",
      "import re\n\ndef solve(text):\n    # Parse the last traceback block.\n    return {\"type\": \"\", \"message\": \"\", \"frames\": []}\n",
      { "python-exceptions": ["sample", "chained"] },
    )],
  },
  {
    id: "logscan-retrieval", title: "Count levels in a deploy log", kind: "code", purpose: "retrieval",
    skillIds: ["file-io"], introducedSkillIds: [],
    explanation: "A deploy log needs the same level counts you built for app logs. Without opening your old solution, recall the pattern: open with a with block, count ERROR/WARN/INFO lines, return the all-zero shape for bad paths. This short retrieval is allowed to fail; its purpose is to find what needs repair.",
    examples: [
      "Input file: 'INFO ok\\nERROR bad\\n'\nOutput: {\"error\": 1, \"warning\": 0, \"info\": 1}",
    ],
    requirements: [
      "Define solve(path). Open with a with block on the executed path.",
      "Non-string paths and unreadable files return the all-zero shape.",
    ],
    hints: ["try/except OSError around the with block."],
    variants: [codeVariant(
      "logscan-retrieval-v1", "deploy-logs", "logscan-challenge", "logscan-v1",
      "def solve(path):\n    counts = {\"error\": 0, \"warning\": 0, \"info\": 0}\n    # with open(path): count levels.\n    return counts\n",
      { "file-io": ["concept-with", "sample"] },
    )],
  },
  {
    id: "pandas-cleanup-retrieval", title: "Clean an inventory CSV", kind: "code", purpose: "retrieval",
    skillIds: ["pandas-data-quality"], introducedSkillIds: [],
    explanation: "An inventory export has the same missing-data problems as the sales CSV: blank ids, missing amounts, bad quantities. Without opening your old solution, recall the pandas pattern: read, drop blank ids, fill amounts with the median, zero bad quantities, unknown regions. This short retrieval is allowed to fail; its purpose is to find what needs repair.",
    examples: [
      "Input: 'id,region,amount,qty\\na,,5.00,x\\n'\nOutput: [{\"id\": \"a\", \"region\": \"unknown\", \"amount\": 5.0, \"qty\": 0}]",
    ],
    requirements: [
      "Define solve(csv_text) using pandas on the executed path.",
      "Drop blank-id rows; fill missing amounts with the median; bad qty becomes 0; blank region becomes unknown.",
    ],
    hints: ["pd.to_numeric(errors=\"coerce\") turns bad text into NaN."],
    variants: [codeVariant(
      "pandas-cleanup-retrieval-v1", "inventory-cleanup", "pandas-clean-challenge", "pandas-clean-v1",
      "import io\nimport pandas as pd\n\ndef solve(csv_text):\n    # pandas cleaning in a new context.\n    return []\n",
      { "pandas-data-quality": ["concept-pandas", "sample", "missing"] },
    )],
  },
  {
    id: "sqlite-totals-retrieval", title: "Regional refund totals", kind: "code", purpose: "retrieval",
    skillIds: ["sqlite-analytics"], introducedSkillIds: [],
    explanation: "A refunds database needs the same regional aggregation you built for orders. Without opening your old solution, recall the pattern: context-manager connection, JOIN on the key, COALESCE nulls, GROUP BY, ORDER BY. This short retrieval is allowed to fail; its purpose is to find what needs repair.",
    examples: [
      "Same contract: solve(db_path) -> [{\"region\", \"orders\", \"total\"}], NULL regions become \"unknown\".",
    ],
    requirements: [
      "Define solve(db_path). Open with a context manager; bad paths and sqlite errors return [].",
      "JOIN, COALESCE, GROUP BY region, ORDER BY total DESC, region ASC.",
    ],
    hints: ["Guard the path with os.path.isfile first."],
    variants: [codeVariant(
      "sqlite-totals-retrieval-v1", "refund-totals", "sqlite-agg-challenge", "sqlite-agg-v1",
      "import os\nimport sqlite3\n\ndef solve(db_path):\n    # Regional aggregation in a new context.\n    return []\n",
      { "sqlite-analytics": ["concept-sqlite", "sample"] },
    )],
  },
  {
    id: "webhook-retry-retrieval", title: "Retry a webhook delivery", kind: "code", purpose: "retrieval",
    skillIds: ["http-reliability"], introducedSkillIds: [],
    explanation: "Webhook deliveries fail like any HTTP call: 429s under load, 500s on bad days. Without opening your old solution, recall the retry policy — which statuses retry, how long each sleep lasts, when to give up. This short retrieval is allowed to fail; its purpose is to find what needs repair.",
    examples: [
      "Same contract: solve(transport, url, sleep) -> {\"ok\", \"status\", \"body\", \"attempts\"}.",
    ],
    requirements: [
      "Define solve(transport, url, sleep) with the injected fake transport.",
      "429 sleeps Retry-After (cap 60); 500s back off 1s then 2s; other statuses never retry; 3 attempts max.",
    ],
    hints: ["The 5xx sleep equals the attempt number as a float."],
    variants: [codeVariant(
      "webhook-retry-retrieval-v1", "webhook-delivery", "http-client-challenge", "http-client-v1",
      "def solve(transport, url, sleep):\n    # Retry policy in a new context.\n    return {\"ok\": False, \"status\": 0, \"body\": \"\", \"attempts\": 0}\n",
      { "http-reliability": ["retries", "exhausted"] },
    )],
  },
  {
    id: "speaker-profile-retrieval", title: "Validate speaker-profile output", kind: "code", purpose: "retrieval",
    skillIds: ["llm-output-validation"], introducedSkillIds: [],
    explanation: "A conference-talk generator emits speaker profiles as JSON text. Without opening your old solution, recall the guardrail: fixed field order, exact types, every error collected. This short retrieval is allowed to fail; its purpose is to find what needs repair.",
    examples: [
      "Input: '{\"name\": \" Ada \", \"age\": 36, \"email\": \"a@x.com\"}'\nOutput: {\"ok\": True, \"data\": {\"name\": \"Ada\", \"age\": 36, \"email\": \"a@x.com\"}, \"errors\": []}",
      "Input: '{\"email\": \"x\"}'\nOutput: {\"ok\": False, \"data\": None, \"errors\": [\"missing_name\", \"missing_age\", \"bad_email\"]}",
    ],
    requirements: [
      "Define solve(raw_text). Non-string input and JSON syntax failures return errors [\"invalid_json\"].",
      "Non-dict JSON returns errors [\"not_an_object\"].",
      "Validate name, age, email in fixed schema order with exact type checks; collect ALL errors as missing_<field>/bad_<field>.",
      "Success returns the stripped profile with errors [].",
    ],
    hints: [
      "Loop over (\"name\", \"age\", \"email\") — never over the input's keys.",
      "age must have exact type int; True is not an age.",
    ],
    variants: [codeVariant(
      "speaker-profile-v1", "speaker-profiles", "llm-guard-challenge", "llm-guard-v1",
      "import json\n\ndef solve(raw_text):\n    # Profile guardrail in a new context.\n    return {\"ok\": False, \"data\": None, \"errors\": [\"invalid_json\"]}\n",
      { "llm-output-validation": ["sample", "schema", "deterministic"] },
    )],
  },
];
