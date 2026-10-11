import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_CORE_SKILLS, DIAGNOSTIC_ITEMS, DIAGNOSTIC_SKILLS, diagnosticItemSchema } from "../curriculum/diagnostic-items";
import { skills } from "../curriculum/skills";
import { gradeDiagnosticConcept, hasConceptGrader } from "../lib/diagnostic-grading";

describe("ladder item bank", () => {
  it("derives ids and titles from the curriculum in learning order", () => {
    expect(DIAGNOSTIC_CORE_SKILLS).toEqual(skills.map(skill => skill.id));
    expect(DIAGNOSTIC_SKILLS).toEqual(skills.map(({ id, title }) => ({ id, title })));
  });

  it("has at least three items ordered from difficulty 1 through 3 for every rung", () => {
    for (const skill of skills) {
      const items = DIAGNOSTIC_ITEMS.filter(item => item.skillId === skill.id);
      expect(items.length, skill.id).toBeGreaterThanOrEqual(3);
      expect(new Set(items.map(item => item.difficulty)), skill.id).toEqual(new Set([1, 2, 3]));
      expect(items.map(item => item.difficulty), skill.id).toEqual([...items.map(item => item.difficulty)].sort());
      for (const item of items) {
        expect(diagnosticItemSchema.safeParse(item).success, item.id).toBe(true);
        if (item.kind === "concept") expect(hasConceptGrader(item.id), item.id).toBe(true);
      }
    }
  });

  it("removed AP data items and rehomed useful foundation ids", () => {
    const ids = DIAGNOSTIC_ITEMS.map(item => item.id);
    expect(ids.some(id => /binary|unicode|compression|packets|fault-tolerance|digital-divide|privacy|open-source/.test(id))).toBe(false);
    const moved: Record<string, string> = {
      "diag-csp-variable": "py-values", "diag-csp-boolean": "py-conditionals", "diag-csp-branch": "py-conditionals",
      "diag-csp-loop-count": "py-loops", "diag-csp-nested": "py-loops", "diag-csp-index": "py-lists-strings",
      "diag-csp-call": "python-functions", "diag-csp-abstraction": "python-functions", "diag-csp-testing": "python-functions",
    };
    for (const [id, skillId] of Object.entries(moved)) expect(DIAGNOSTIC_ITEMS.find(item => item.id === id)?.skillId).toBe(skillId);
    expect(ids).not.toContain("diag-fn-isqrt-output");
    expect(ids).not.toContain("diag-fn-loop-var");
  });

  it("each concept grader accepts its canonical answer and rejects an unrelated answer", () => {
    for (const item of DIAGNOSTIC_ITEMS.filter(item => item.kind === "concept")) {
      const answer = sampleFor(item.id);
      expect(gradeDiagnosticConcept(item.id, answer).correct, `${item.id} canonical ${answer}`).toBe(true);
      expect(gradeDiagnosticConcept(item.id, "banana nonsense").correct, `${item.id} wrong`).toBe(false);
    }
  });

  it("grades exact code-reading answers and rejects plausible wrong values", () => {
    const cases: Record<string, [string, string, string, string]> = {
      "diag-fn-return": ["4", "'4'", "5", "3"],
      "diag-money-decimal": ["0.30", "'0.30'", "0.3", "0.31"],
      "diag-money-negative": ["True", "true", "False", "-5"],
      "diag-http-retry-after": ["True", "true", "False", "yes"],
      "diag-http-2xx": ["True", "true", "False", "2xx"],
      "diag-exc-catch": ["0", " 0 ", "1", "bad"],
      "diag-exc-finally": ["3", " 3 ", "0", "finally"],
      "diag-file-close": ["ok", "'ok'", "closed", "OK!"],
      "diag-file-modes": ["new", "'new'", "oldnew", "old"],
      "diag-fn-default-arg": ["5", " 5 ", "4", "6"],
      "diag-exc-bare": ["caught", "'caught'", "bad", "ValueError"],
      "diag-money-quantize": ["1.24", "'1.24'", "1.23", "1.2"],
      "diag-llm-schema": ["int", "'int'", "str", "7"],
      "diag-llm-deterministic": ["False", "false", "True", "different"],
      "diag-csv-header": ["Ada", "'Ada'", "age", "Bob"],
      "diag-csv-strip": ["Ada", "\"Ada\"", "age", "ada."],
      "diag-csv-empty": ["Ada", "'Ada'", "name", "7"],
      "diag-csv-dictreader": ["7", "'7'", "age", "Ada"],
      "diag-json-nested": ["Ada", "'Ada'", "dict", "name"],
      "diag-loops-range": ["3", " 3 ", "2", "4"],
      "diag-lists-first": ["['blue', 'green']", "[\"blue\", \"green\"]", "['red', 'green']", "['blue']"],
      "diag-lists-string": ["red|blue", "'red|blue'", "red,blue", "blue|red"],
      "diag-dicts-get": ["2", " 2 ", "1", "3"],
      "diag-dicts-length": ["0", " 0 ", "None", "1"],
      "diag-dicts-membership": ["{'x': 2, 'y': 1}", "{\"x\": 2, \"y\": 1}", "{'x': 1, 'y': 2}", "{'x': 2}"],
      "diag-classes-init": ["Dog: Rex", "'Dog: Rex'", "Dog: rex", "Rex"],
      "diag-classes-self": ["blue", "'blue'", "green", "red"],
      "diag-classes-instance": ["2", " 2 ", "1", "3"],
      "diag-pandas-missing": ["{'age': 1}", "{\"age\": 1}", "{'age': 0}", "{'age': 2}"],
      "diag-pandas-dropna": ["[10.0, 0.0, 12.0]", "[10, 0, 12]", "[10, 12]", "[10, 0, 0]"],
      "diag-pandas-fillna": ["[10, 0, 12]", "[10.0, 0.0, 12.0]", "[10, 12]", "[0, 10, 12]"],
      "diag-sqlite-select": ["blue, 1; red, 2", "blue: 1; red: 2", "blue, 2; red, 1", "blue, 1; red, 1"],
      "diag-sqlite-where": ["6", " 6 ", "2", "9"],
      "diag-sqlite-count": ["blue, 1; red, 2", "blue: 1; red: 2", "blue, 2; red, 1", "blue, 1; red, 1"],
    };
    for (const [id, [acceptA, acceptB, rejectA, rejectB]] of Object.entries(cases)) {
      expect(gradeDiagnosticConcept(id, acceptA).correct, `${id} accepts ${acceptA}`).toBe(true);
      expect(gradeDiagnosticConcept(id, acceptB).correct, `${id} accepts ${acceptB}`).toBe(true);
      expect(gradeDiagnosticConcept(id, rejectA).correct, `${id} rejects ${rejectA}`).toBe(false);
      expect(gradeDiagnosticConcept(id, rejectB).correct, `${id} rejects ${rejectB}`).toBe(false);
    }
  });
});

function sampleFor(id: string): string {
  const samples: Record<string, string> = {
    "diag-csp-loop-count": "4", "diag-csp-boolean": "True", "diag-csp-branch": "pass", "diag-csp-variable": "6",
    "diag-csp-call": "6", "diag-csp-index": "bee", "diag-csp-abstraction": "function", "diag-csp-nested": "6",
    "diag-csp-testing": "boundary cases around 60", "diag-fn-return": "4", "diag-fn-default-arg": "5",
    "diag-exc-catch": "0", "diag-exc-bare": "caught", "diag-exc-finally": "3",
    "diag-exc-raise": "raise ValueError", "diag-exc-chain": "original exception cause",
    "diag-ds-clean-value": "False; name.strip()", "diag-ds-dict-get": "row.get('id')", "diag-ds-comprehension": "list",
    "diag-ds-mutation": "[1, 2, 3]", "diag-ds-sort-key": "sorted by amount key reverse=True",
    "diag-csv-header": "Ada", "diag-csv-strip": "Ada", "diag-csv-quoted": "one field", "diag-csv-empty": "Ada",
    "diag-json-loads": "list", "diag-json-envelope": "dict with payments list", "diag-json-decode-error": "JSONDecodeError",
    "diag-json-types": "strict type check", "diag-json-dumps": "string", "diag-money-decimal": "0.30",
    "diag-money-quantize": "1.24", "diag-money-negative": "True", "diag-money-currency": "upper",
    "diag-http-retry-after": "True", "diag-http-2xx": "True", "diag-http-429": "no, back off", "diag-http-timeout": "timeout",
    "diag-file-close": "ok", "diag-file-modes": "new", "diag-file-readlines": "list",
    "diag-file-newline": "\\n strip", "diag-llm-schema": "int", "diag-llm-deterministic": "False",
    "diag-llm-fallback": "deterministic fallback",
    "diag-values-type": "float", "diag-values-reassign": "6", "diag-values-print": "hello", "diag-values-add": "10",
    "diag-if-elif": "mid", "diag-conditionals-compare": "True", "diag-conditionals-branch": "yes",
    "diag-loops-sum": "12", "diag-loops-range": "3", "diag-loops-final": "5", "diag-lists-length": "3",
    "diag-lists-slice": "[20, 30]", "diag-lists-first": "['blue', 'green']", "diag-lists-string": "red|blue",
    "diag-dicts-get": "2", "diag-dicts-length": "0", "diag-dicts-membership": "{'x': 2, 'y': 1}",
    "diag-classes-init": "Dog: Rex", "diag-classes-self": "blue", "diag-classes-instance": "2",
    "diag-pandas-missing": "{'age': 1}", "diag-pandas-dropna": "[10.0, 0.0, 12.0]", "diag-pandas-fillna": "[10, 0, 12]",
    "diag-sqlite-select": "blue, 1; red, 2", "diag-sqlite-where": "6", "diag-sqlite-count": "blue, 1; red, 2",
    "diag-csv-dictreader": "7", "diag-json-nested": "Ada", "diag-money-round": "Decimal",
    "diag-http-retry": "backoff reduces load", "diag-file-write": "append", "diag-llm-shape": "expected type",
  };
  return samples[id] ?? id.replaceAll("diag-", "").replaceAll("-", " ");
}
