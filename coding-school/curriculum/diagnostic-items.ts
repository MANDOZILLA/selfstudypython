import { z } from "zod";
import { skills } from "./skills";

// The curriculum registry is the single source of truth for placement order.

/**
 * Stable skill IDs probed by the placement diagnostic in curriculum order.
 */
export const DIAGNOSTIC_CORE_SKILLS = skills.map(skill => skill.id) as string[];
export type DiagnosticSkillId = string;

/** Display metadata for the probed skills. Titles are learner-facing. */
export const DIAGNOSTIC_SKILLS: { id: DiagnosticSkillId; title: string }[] = skills.map(({ id, title }) => ({ id, title }));

export const diagnosticItemSchema = z.object({
  id: z.string().min(1),
  skillId: z.string().min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  kind: z.enum(["concept", "coding"]),
  prompt: z.string().min(10),
  hints: z.array(z.string().min(5)).min(2),
  coding: z.object({
    exerciseId: z.string().min(1),
    graderId: z.string().min(1),
    starterCode: z.string().min(1),
    entryFunction: z.string().min(1),
  }).optional(),
  concept: z.object({
    graderId: z.string().min(1),
    gradingNotes: z.string().min(10),
    /** Code-reading items: the exact stdout of the prompt's ```python block (tests execute it). */
    expectedOutput: z.string().min(1).optional(),
    /** Other spellings of the same output that are also correct. */
    acceptAlso: z.array(z.string().min(1)).optional(),
  }).optional(),
}).superRefine((item, ctx) => {
  if (item.kind === "coding" && !item.coding) ctx.addIssue({ code: "custom", message: `coding item ${item.id} needs coding details` });
  if (item.kind === "concept" && !item.concept) ctx.addIssue({ code: "custom", message: `concept item ${item.id} needs concept grading details` });
  if (item.kind === "coding" && item.coding && !item.coding.starterCode.includes(item.coding.entryFunction)) {
    ctx.addIssue({ code: "custom", message: `starter code for ${item.id} must mention ${item.coding.entryFunction}` });
  }
});
export type DiagnosticItem = z.infer<typeof diagnosticItemSchema>;

const concept = (
  id: string, skillId: string, difficulty: 1 | 2 | 3, prompt: string, hints: string[], gradingNotes: string,
): DiagnosticItem => ({ id, skillId, difficulty, kind: "concept", prompt, hints, concept: { graderId: `diagnostic-concept-${id}`, gradingNotes } });
const coding = (
  id: string, skillId: string, difficulty: 1 | 2 | 3, prompt: string, hints: string[],
  exerciseId: string, graderId: string, starterCode: string, entryFunction: string,
): DiagnosticItem => ({ id, skillId, difficulty, kind: "coding", prompt, hints, coding: { exerciseId, graderId, starterCode, entryFunction } });

/** Joins source lines into one Python block. */
const py = (...lines: string[]) => lines.join("\n");
/**
 * Code-reading item: the prompt shows a runnable ```python block and the
 * answer is its exact stdout. tests/diagnostic-snippets.test.ts executes every
 * block in Pyodide and checks it really prints `expectedOutput`.
 */
const output = (
  id: string, skillId: string, difficulty: 1 | 2 | 3, code: string, expectedOutput: string, hints: string[],
  acceptAlso: string[] = [], lead = "What does this print?",
): DiagnosticItem => ({
  id, skillId, difficulty, kind: "concept", prompt: `${lead}\n\`\`\`python\n${code}\n\`\`\``, hints,
  concept: {
    graderId: `diagnostic-concept-${id}`,
    gradingNotes: `Correct iff the answer is the exact printed output: ${expectedOutput}${acceptAlso.length ? ` (also accept ${acceptAlso.join(" / ")})` : ""}.`,
    expectedOutput, ...(acceptAlso.length ? { acceptAlso } : {}),
  },
});

// Within a rung, items are served easiest first (sorted by difficulty below),
// and the first two decide most learners, so they are always exact code reading.
// Ids are stable: stored responses reference them.
const RAW_DIAGNOSTIC_ITEMS: DiagnosticItem[] = [
  // ---- py-values ----
  output("diag-values-print", "py-values", 1, py("print('hello')"), "hello",
    ["The quoted text is a string.", "print shows the string without its quotes."]),
  output("diag-values-add", "py-values", 1, py("x = 7", "y = 3", "print(x + y)"), "10",
    ["Each variable holds a number.", "print shows the result of the addition."]),
  output("diag-csp-variable", "py-values", 2, py("count = 1", "count = count + 5", "print(count)"), "6",
    ["The second line reassigns `count`.", "The right side reads the current value first."]),
  output("diag-values-fstring", "py-values", 3, py("age = 9", "print(f'Next year: {age + 1}')"), "Next year: 10",
    ["An f-string runs the code inside the braces.", "Everything outside the braces is printed as written."]),

  // ---- py-conditionals ----
  output("diag-conditionals-compare", "py-conditionals", 1, py("print(4 < 9)"), "True",
    ["A comparison produces a boolean.", "Is 4 smaller than 9?"]),
  output("diag-csp-boolean", "py-conditionals", 2, py("print(not (3 > 5))"), "True",
    ["Evaluate the comparison inside the parentheses first.", "`not` flips a boolean."]),
  output("diag-csp-branch", "py-conditionals", 2,
    py("score = 72", "if score >= 60:", "    print('pass')", "else:", "    print('fail')"), "pass",
    ["Compare 72 against 60.", "Only one branch runs."]),
  output("diag-conditionals-branch", "py-conditionals", 3,
    py("temp = 18", "if temp < 10:", "    print('cold')", "elif temp < 25:", "    print('mild')", "else:", "    print('hot')"), "mild",
    ["Conditions are checked from the top.", "The first true condition wins; the rest are skipped."]),

  // ---- py-loops ----
  output("diag-csp-loop-count", "py-loops", 1,
    py("total = 0", "for i in range(4):", "    total = total + 1", "print(total)"), "4",
    ["The body runs once per value of `i`.", "How many values does range(4) produce?"]),
  output("diag-loops-final", "py-loops", 2,
    py("total = 0", "for n in range(1, 4):", "    total = total + n", "print(total)"), "6",
    ["range(1, 4) stops before 4.", "Add each value of n to total."]),
  output("diag-loops-range", "py-loops", 2,
    py("n = 0", "while n < 3:", "    n = n + 1", "print(n)"), "3",
    ["The loop keeps going while the condition is true.", "The print runs once, after the loop ends."]),
  output("diag-csp-nested", "py-loops", 3,
    py("count = 0", "for row in range(3):", "    for col in range(2):", "        count = count + 1", "print(count)"), "6",
    ["The inner loop runs fully for every outer pass.", "Multiply the two loop lengths."]),
  output("diag-loops-break", "py-loops", 3,
    py("for n in range(10):", "    if n * n > 20:", "        break", "print(n)"), "5",
    ["`break` leaves the loop immediately.", "n keeps its last value after the loop."]),

  // ---- py-lists-strings ----
  output("diag-csp-index", "py-lists-strings", 1, py("items = ['ant', 'bee', 'cat']", "print(items[1])"), "bee",
    ["List positions start at 0.", "Position 1 is the second element."]),
  output("diag-lists-first", "py-lists-strings", 2, py("colors = ['red', 'blue', 'green']", "print(colors[1:3])"), "['blue', 'green']",
    ["A slice starts at its first index.", "The end index is not included."]),
  output("diag-lists-append", "py-lists-strings", 2,
    py("doubles = []", "for n in range(3):", "    doubles.append(n * 2)", "print(doubles)"), "[0, 2, 4]",
    ["The list starts empty.", "Each pass adds one value to the end."]),
  output("diag-lists-string", "py-lists-strings", 3,
    py("parts = 'red,blue'.split(',')", "print('|'.join(parts))"), "red|blue",
    ["`split` breaks the text at each comma.", "`join` puts the separator between the pieces."]),

  // ---- python-functions ----
  output("diag-csp-call", "python-functions", 1,
    py("def double(n):", "    return n * 2", "", "result = double(3)", "print(result)"), "6",
    ["Inside the call, n holds 3.", "`return` hands the value back to the caller."]),
  output("diag-fn-return", "python-functions", 1,
    py("def add_one(n):", "    return n + 1", "", "def show():", "    return add_one(3)", "", "print(show())"), "4",
    ["Follow the call from `show` into `add_one`.", "Each function returns its value to whoever called it."]),
  output("diag-fn-default-arg", "python-functions", 2,
    py("def add(n):", "    return n + 2", "", "def twice(n):", "    return add(add(n))", "", "print(twice(1))"), "5",
    ["The inner call runs first.", "Its result is passed to the outer call."]),
  output("diag-csp-abstraction", "python-functions", 2,
    py("def shout(word):", "    word.upper()", "", "print(shout('hi'))"), "None",
    ["Look for a `return` statement in `shout`.", "What does a function give back when it never returns a value?"]),
  concept("diag-csp-testing", "python-functions", 3,
    "`def is_passing(score)` returns True when `score >= 60`. Which test inputs give the most confidence that it works?",
    ["Think about where the function's behavior changes.", "The strongest tests probe just below, at, and just above that point."],
    "Correct iff the answer points at boundary/edge cases (accept 'boundary', 'edge cases', '59, 60, 61', 'just below and above 60'). 'only 100' fails."),
  coding("diag-fn-callforms", "python-functions", 3,
    "Write `solve(payload)`: `payload` is a JSON list of numbers like `'[1.2, 2.7]'`. Parse it with `json.loads`, round every number up with `map` and `math.ceil`, and return a plain list.",
    ["Parse first: `json.loads(payload)` gives you the list.", "Round up each value: `map(ceil, values)` then `list(...)`.", "Keyword forms like `json.loads(s=payload)` are fine as long as the call result is used."],
    "diagnostic-call-forms", "diagnostic-call-forms-v1",
    "import json\nfrom math import ceil\n\ndef solve(payload):\n    # payload: a JSON list of numbers, e.g. '[1.2, 2.7]'\n    # Parse it, round each number up, and return a list.\n    return []\n",
    "solve"),

  // ---- py-dicts ----
  output("diag-dicts-length", "py-dicts", 1, py("scores = {'Ada': 4}", "print(scores.get('Bo', 0))"), "0",
    ["Bo is not a key in the dictionary.", "`.get` returns its second argument for a missing key."]),
  output("diag-dicts-loop", "py-dicts", 2,
    py("prices = {'tea': 2, 'pie': 5}", "total = 0", "for name in prices:", "    total = total + prices[name]", "print(total)"), "7",
    ["Looping over a dict gives its keys.", "Each key looks up its price."]),
  output("diag-dicts-get", "py-dicts", 2,
    py("counts = {}", "for word in ['a', 'b', 'a']:", "    counts[word] = counts.get(word, 0) + 1", "print(counts['a'])"), "2",
    ["`.get(word, 0)` starts a missing count at zero.", "How many times does the loop see 'a'?"]),
  output("diag-dicts-membership", "py-dicts", 3,
    py("counts = {}", "for word in ['x', 'y', 'x']:", "    counts[word] = counts.get(word, 0) + 1", "print(counts)"), "{'x': 2, 'y': 1}",
    ["Keys keep the order they were first added.", "Count every word."]),

  // ---- python-exceptions ----
  output("diag-exc-catch", "python-exceptions", 1,
    py("try:", "    age = int('bad')", "except ValueError:", "    age = 0", "print(age)"), "0",
    ["int('bad') cannot convert the text.", "The except block runs when that error happens."]),
  output("diag-exc-bare", "python-exceptions", 2,
    py("try:", "    raise ValueError('bad')", "except Exception:", "    print('caught')"), "caught",
    ["ValueError is a kind of Exception.", "The handler prints its own text."]),
  output("diag-exc-finally", "python-exceptions", 2,
    py("try:", "    value = int('3')", "except ValueError:", "    value = 0", "finally:", "    print(value + 1)"), "4",
    ["Does int('3') raise an error?", "`finally` runs whether or not an error happened."]),
  output("diag-exc-raise", "python-exceptions", 3,
    py("def parse_age(text):", "    if not text.isdigit():", "        raise ValueError('bad age')", "    return int(text)", "",
      "try:", "    parse_age('x1')", "except ValueError as err:", "    print(err)"), "bad age",
    ["'x1' is not all digits.", "Printing an exception shows its message."]),
  output("diag-exc-chain", "python-exceptions", 3,
    py("try:", "    try:", "        int('x')", "    except ValueError as err:", "        raise RuntimeError('bad row') from err",
      "except RuntimeError as outer:", "    print(type(outer.__cause__).__name__)"), "ValueError",
    ["`raise ... from err` records the original error.", "`__cause__` holds that original error."]),

  // ---- file-io ----
  output("diag-file-close", "file-io", 1,
    py("from io import StringIO", "", "with StringIO('ok') as f:", "    text = f.read()", "print(text)"), "ok",
    ["StringIO behaves like an open text file.", "`read` returns everything in it."]),
  output("diag-file-newline", "file-io", 2,
    py("from io import StringIO", "", "names = []", "for line in StringIO('Ada\\nLin\\n'):", "    names.append(line.strip())", "print(names)"), "['Ada', 'Lin']",
    ["Looping over a file gives one line at a time.", "Each line ends with a newline until it is stripped."]),
  output("diag-file-readlines", "file-io", 2,
    py("from io import StringIO", "", "lines = StringIO('a\\nb\\n').readlines()", "print(len(lines), lines[0] == 'a')"), "2 False",
    ["`readlines` returns a list of lines.", "Do the lines keep their trailing newline?"]),
  coding("diag-file-with", "file-io", 2,
    "Write `read_lines(path)`: open the file with a `with`-statement and return its lines with trailing newlines removed. The file object returned by `open()` must be the one the `with`-statement manages.",
    ["`with open(path) as f:` manages the file for you.", "Read the lines inside the block.", "Strip the trailing newline from each line."],
    "diagnostic-files", "diagnostic-files-v1",
    "def read_lines(path):\n    # Open path with a with-statement; return lines without trailing newlines.\n    return []\n",
    "read_lines"),
  output("diag-file-modes", "file-io", 3,
    py("from io import StringIO", "", "f = StringIO('old')", "f.write('new')", "print(f.getvalue())"), "new",
    ["A fresh StringIO starts writing at position 0.", "Writing replaces characters from that position."]),
  concept("diag-file-write", "file-io", 3, "A file holds `a`. What does it hold after `with open(path, 'a') as f: f.write('b')`?",
    ["The mode letter is a clue.", "'w' would replace the contents; this mode does not."],
    "Correct iff the answer is the appended contents 'ab' (accept 'ab', or saying it appends b after a)."),

  // ---- py-classes ----
  output("diag-classes-init", "py-classes", 1,
    py("class Dog:", "    def __init__(self, name):", "        self.name = name", "", "    def describe(self):", "        return 'Dog: ' + self.name", "",
      "d = Dog('Rex')", "print(d.describe())"), "Dog: Rex",
    ["Creating `d` runs `__init__`, storing the name on the object.", "`describe` reads it back through `self`."]),
  output("diag-classes-self", "py-classes", 2,
    py("class Tag:", "    def __init__(self, value):", "        self.value = value", "",
      "a = Tag('red')", "b = Tag('blue')", "a.value = 'green'", "print(b.value)"), "blue",
    ["Each call to Tag creates a separate object.", "Which object was changed?"]),
  output("diag-classes-instance", "py-classes", 3,
    py("class Counter:", "    def __init__(self):", "        self.n = 0", "", "    def add(self):", "        self.n += 1", "",
      "c = Counter()", "c.add()", "c.add()", "print(c.n)"), "2",
    ["`add` changes the object's stored n.", "The method runs twice on the same object."]),

  // ---- data-structures ----
  output("diag-ds-dict-get", "data-structures", 1,
    py("row = {'id': 7}", "records = [row]", "print(records[0].get('id'))"), "7",
    ["The list holds one dictionary.", "Read its id."]),
  output("diag-ds-clean-value", "data-structures", 2,
    py("rows = [{'name': ' Ada '}, {'name': 'Lin '}]", "print([r['name'].strip() for r in rows])"), "['Ada', 'Lin']",
    ["The comprehension builds a new list, one item per row.", "`strip` removes spaces at both ends."]),
  output("diag-ds-comprehension", "data-structures", 2,
    py("rows = [{'id': 1, 'ok': True}, {'id': 2, 'ok': False}, {'id': 3, 'ok': True}]", "print([r['id'] for r in rows if r['ok']])"), "[1, 3]",
    ["The `if` keeps only some rows.", "Each kept row contributes its id."]),
  output("diag-ds-mutation", "data-structures", 2, py("a = [1, 2]", "b = a", "b.append(3)", "print(a)"), "[1, 2, 3]",
    ["Does `b = a` copy the list or share it?", "Appending through `b` changes the shared list."]),
  output("diag-ds-sort-key", "data-structures", 3,
    py("rows = [{'id': 1, 'amount': 3}, {'id': 2, 'amount': 9}, {'id': 3, 'amount': 5}]",
      "top = sorted(rows, key=lambda r: r['amount'], reverse=True)", "print([r['id'] for r in top])"), "[2, 3, 1]",
    ["The key decides what is compared: each row's amount.", "`reverse=True` puts the largest first."]),

  // ---- csv-cleaning ----
  output("diag-csv-header", "csv-cleaning", 1,
    py("import csv, io", "", "reader = csv.DictReader(io.StringIO('name,age\\nAda,7\\n'))", "print(next(reader)['name'])"), "Ada",
    ["The first line names the columns.", "`next` returns the first data row."]),
  output("diag-csv-strip", "csv-cleaning", 2,
    py("import csv, io", "", "row = next(csv.DictReader(io.StringIO('name,city\\nAda, Oslo \\n')))", "print(row['city'].strip() + '!')"), "Oslo!",
    ["csv keeps the spaces around a value.", "`strip` removes them before the `!` is added."]),
  output("diag-csv-quoted", "csv-cleaning", 2,
    py("import csv, io", "", "row = next(csv.reader(io.StringIO('\"a,b\",c\\n')))", "print(len(row))"), "2",
    ["Quotes protect a comma inside a field.", "Count the fields, not the commas."]),
  output("diag-csv-dictreader", "csv-cleaning", 3,
    py("import csv, io", "", "row = next(csv.DictReader(io.StringIO('name,age\\nAda,7\\n')))", "print(type(row['age']).__name__)"), "str",
    ["csv does not convert values for you.", "Every field arrives as text."]),
  output("diag-csv-empty", "csv-cleaning", 3,
    py("import csv, io", "", "rows = list(csv.reader(io.StringIO('name\\nAda\\n\\nLin\\n')))", "print(len(rows), rows[2])"), "4 []",
    ["The blank line is still read as a row.", "A blank row has no fields."]),

  // ---- financial-data ----
  output("diag-money-decimal", "financial-data", 1,
    py("from decimal import Decimal", "", "print(Decimal('0.10') + Decimal('0.20'))"), "0.30",
    ["Decimal keeps these values exact.", "Decimal keeps the two decimal places."]),
  output("diag-money-quantize", "financial-data", 2,
    py("from decimal import Decimal", "", "print(Decimal('1.236').quantize(Decimal('0.01')))"), "1.24",
    ["quantize rounds to the places of its argument.", "The third decimal decides the rounding."]),
  output("diag-money-negative", "financial-data", 2,
    py("from decimal import Decimal", "", "print(sum([Decimal('5.00'), Decimal('-2.50')]))"), "2.50",
    ["A refund is a negative amount.", "Decimal keeps two places in the result."]),
  output("diag-money-currency", "financial-data", 2,
    py("codes = ['usd', ' USD', 'Usd']", "print(len({c.strip().upper() for c in codes}))"), "1",
    ["The set holds each distinct cleaned code once.", "What does each code become after strip and upper?"]),
  output("diag-money-round", "financial-data", 3,
    py("from decimal import Decimal", "", "print(0.1 + 0.2 == 0.3, Decimal('0.1') + Decimal('0.2') == Decimal('0.3'))"), "False True",
    ["Binary floats cannot store 0.1 exactly.", "Decimal can."]),

  // ---- json-validation ----
  output("diag-json-loads", "json-validation", 1,
    py("import json", "", "data = json.loads('[1, 2]')", "print(type(data).__name__)"), "list",
    ["A JSON array becomes one specific Python type.", "Print shows that type's name."]),
  output("diag-json-dumps", "json-validation", 1,
    py("import json", "", "text = json.dumps({'a': 1})", "print(type(text).__name__)"), "str",
    ["`dumps` turns Python data into JSON text.", "Print shows the type's name."]),
  output("diag-json-decode-error", "json-validation", 2,
    py("import json", "", "try:", "    json.loads('{bad')", "except Exception as err:", "    print(type(err).__name__)"), "JSONDecodeError",
    ["'{bad' is not valid JSON.", "The json module raises its own error type."]),
  output("diag-json-nested", "json-validation", 2,
    py("import json", "", "data = json.loads('{\"user\": {\"tags\": [\"a\", \"b\"]}}')", "print(data['user']['tags'][-1])"), "b",
    ["Follow the keys from the outside in.", "Index -1 is the last element."]),
  output("diag-json-envelope", "json-validation", 3,
    py("import json", "", "payload = json.loads('{\"payments\": null}')", "print(isinstance(payload, dict), isinstance(payload.get('payments'), list))"), "True False",
    ["JSON null becomes Python None.", "Check the outer container and the field separately."]),
  output("diag-json-types", "json-validation", 3,
    py("payload = {'id': True}", "print(bool(payload['id']), type(payload['id']) is str)"), "True False",
    ["True is truthy.", "A truthiness check would accept it; a type check would not."]),

  // ---- pandas-data-quality ----
  output("diag-pandas-missing", "pandas-data-quality", 1,
    py("import pandas as pd", "", "df = pd.DataFrame({'age': [10, None, 12]})", "print(df['age'].isna().sum())"), "1",
    ["`isna` marks each missing cell True.", "`sum` counts the True values."]),
  output("diag-pandas-dropna", "pandas-data-quality", 2,
    py("import pandas as pd", "", "df = pd.DataFrame({'age': [10, None, 12]})", "print(df['age'].dropna().tolist())"), "[10.0, 12.0]",
    ["`dropna` removes the missing value.", "A number column with a gap is stored as floats."], ["[10, 12]"]),
  output("diag-pandas-fillna", "pandas-data-quality", 3,
    py("import pandas as pd", "", "df = pd.DataFrame({'city': ['Oslo', None, 'Rome', None]})", "print((df['city'].fillna('unknown') == 'unknown').sum())"), "2",
    ["`fillna` replaces every missing cell.", "The comparison marks each replaced cell True."]),

  // ---- sqlite-analytics ----
  output("diag-sqlite-select", "sqlite-analytics", 1,
    py("import sqlite3", "", "db = sqlite3.connect(':memory:')", "db.execute('CREATE TABLE sales (color TEXT, qty INTEGER)')",
      "db.executemany('INSERT INTO sales VALUES (?, ?)', [('red', 2), ('blue', 3), ('red', 4)])",
      "print(db.execute('SELECT COUNT(*) FROM sales').fetchone()[0])"), "3",
    ["COUNT(*) counts rows.", "`fetchone()[0]` is the single value."]),
  output("diag-sqlite-where", "sqlite-analytics", 2,
    py("import sqlite3", "", "db = sqlite3.connect(':memory:')", "db.execute('CREATE TABLE sales (color TEXT, qty INTEGER)')",
      "db.executemany('INSERT INTO sales VALUES (?, ?)', [('red', 2), ('blue', 3), ('red', 4)])",
      "print(db.execute(\"SELECT SUM(qty) FROM sales WHERE color = 'red'\").fetchone()[0])"), "6",
    ["WHERE keeps only the red rows.", "SUM adds their qty values."]),
  output("diag-sqlite-count", "sqlite-analytics", 3,
    py("import sqlite3", "", "db = sqlite3.connect(':memory:')", "db.execute('CREATE TABLE sales (color TEXT, qty INTEGER)')",
      "db.executemany('INSERT INTO sales VALUES (?, ?)', [('red', 2), ('blue', 3), ('red', 4)])",
      "print(db.execute('SELECT color, COUNT(*) FROM sales GROUP BY color ORDER BY color').fetchall())"), "[('blue', 1), ('red', 2)]",
    ["GROUP BY makes one result row per color.", "ORDER BY color sorts the groups alphabetically."]),

  // ---- http-reliability ----
  output("diag-http-2xx", "http-reliability", 1, py("status = 201", "print(200 <= status < 300)"), "True",
    ["Success codes are the 2xx family.", "Is 201 in that range?"]),
  output("diag-http-retry-after", "http-reliability", 2,
    py("def should_retry(status):", "    return status == 429 or status >= 500", "", "print(should_retry(404), should_retry(503))"), "False True",
    ["404 means the resource does not exist; retrying will not help.", "5xx errors and 429 can succeed later."]),
  concept("diag-http-429", "http-reliability", 2,
    "Your client receives 429 Too Many Requests. Is retrying immediately the right move?",
    ["What does 429 ask you to do?", "Name the correct strategy in a few words."],
    "Correct iff the answer is no with waiting/backing off (accept 'no, wait', 'back off', 'no, respect Retry-After'). Bare 'yes' fails."),
  concept("diag-http-timeout", "http-reliability", 2,
    "A request can hang forever. What client setting bounds how long you wait?",
    ["It is a per-request limit in seconds.", "Answer with the setting name."],
    "Correct iff the answer is 'timeout'."),
  output("diag-http-retry", "http-reliability", 3, py("print([0.5 * 2 ** attempt for attempt in range(4)])"), "[0.5, 1.0, 2.0, 4.0]",
    ["`**` binds tighter than `*`.", "Each attempt doubles the wait: exponential backoff."]),
  coding("diag-http-success", "http-reliability", 3,
    "Write `is_success(status)`: return True when `status` is an HTTP success code, False otherwise. Remember which family of codes counts as success, and test the edges: 199, 200, 299, 300.",
    ["Success codes are the 2xx family.", "199 is not success; 300 is not success.", "A range check like 200 <= status < 300 handles every edge."],
    "diagnostic-http", "diagnostic-http-v1",
    "def is_success(status):\n    # Return True when status is an HTTP success code, else False.\n    return False\n",
    "is_success"),

  // ---- llm-output-validation ----
  output("diag-llm-schema", "llm-output-validation", 1,
    py("import json", "", "data = json.loads('{\"age\": 7}')", "print(type(data['age']).__name__)"), "int",
    ["json.loads parses the model's text into Python data.", "A JSON number without a dot becomes a whole number."]),
  output("diag-llm-shape", "llm-output-validation", 2,
    py("import json", "", "data = json.loads('{\"name\": 42}')", "print(isinstance(data.get('name'), str))"), "False",
    ["The model returned a number, not text.", "isinstance checks the type."]),
  output("diag-llm-deterministic", "llm-output-validation", 2,
    py("import json", "", "data = json.loads('{\"label\": \"Spam\"}')", "print(data.get('label') in {'spam', 'ham'})"), "False",
    ["Set membership is exact.", "Compare the capital letters."]),
  output("diag-llm-fallback", "llm-output-validation", 3,
    py("import json", "", "def parse_label(reply):", "    try:", "        data = json.loads(reply)", "    except json.JSONDecodeError:", "        return 'unknown'",
      "    label = data.get('label') if isinstance(data, dict) else None", "    return label if label in {'spam', 'ham'} else 'unknown'", "",
      "print(parse_label('{\"label\": \"eggs\"}'), parse_label('not json'))"), "unknown unknown",
    ["Both replies fail a different check.", "Every failure returns the same safe fallback."]),
];

const ladderOrder = new Map(skills.map((skill, index) => [skill.id, index]));
export const DIAGNOSTIC_ITEMS: DiagnosticItem[] = [...RAW_DIAGNOSTIC_ITEMS].sort((a, b) =>
  (ladderOrder.get(a.skillId) ?? Number.MAX_SAFE_INTEGER) - (ladderOrder.get(b.skillId) ?? Number.MAX_SAFE_INTEGER) ||
  a.difficulty - b.difficulty,
);
