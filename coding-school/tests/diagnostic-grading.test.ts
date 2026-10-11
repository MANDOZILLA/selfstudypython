import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_ITEMS } from "../curriculum/diagnostic-items";
import { gradeDiagnosticConcept, hasConceptGrader } from "../lib/diagnostic-grading";

const answers: Record<string, string> = {
  "diag-csp-variable": "6", "diag-csp-boolean": "True", "diag-csp-branch": "pass", "diag-csp-loop-count": "4",
  "diag-csp-nested": "6", "diag-csp-index": "bee", "diag-csp-call": "6", "diag-csp-abstraction": "function",
  "diag-csp-testing": "boundary cases around 60", "diag-fn-return": "4", "diag-fn-default-arg": "5",
  "diag-exc-catch": "0", "diag-exc-bare": "caught", "diag-exc-finally": "3",
  "diag-exc-raise": "raise ValueError", "diag-exc-chain": "original exception cause",
  "diag-ds-clean-value": "False; name.strip()", "diag-ds-dict-get": "row.get('id')", "diag-ds-comprehension": "list",
  "diag-ds-mutation": "[1, 2, 3]", "diag-ds-sort-key": "sorted with amount key reverse=True",
  "diag-csv-header": "Ada", "diag-csv-strip": "Ada", "diag-csv-quoted": "one field", "diag-csv-empty": "Ada",
  "diag-json-loads": "list", "diag-json-envelope": "dict with payments list", "diag-json-decode-error": "JSONDecodeError",
  "diag-json-types": "strict type check", "diag-json-dumps": "string", "diag-money-decimal": "0.30",
  "diag-money-quantize": "1.24", "diag-money-negative": "True", "diag-money-currency": "upper",
  "diag-http-retry-after": "True", "diag-http-2xx": "True", "diag-http-429": "no, back off", "diag-http-timeout": "timeout",
  "diag-file-close": "ok", "diag-file-modes": "new", "diag-file-readlines": "list", "diag-file-newline": "\\n strip",
  "diag-llm-schema": "int", "diag-llm-deterministic": "False", "diag-llm-fallback": "deterministic fallback",
  "diag-values-type": "float", "diag-values-reassign": "6", "diag-values-print": "hello", "diag-values-add": "10",
  "diag-if-elif": "mid", "diag-conditionals-compare": "True", "diag-conditionals-branch": "yes", "diag-loops-sum": "12",
  "diag-loops-range": "3", "diag-loops-final": "5", "diag-lists-length": "3", "diag-lists-slice": "[20, 30]",
  "diag-lists-first": "['blue', 'green']", "diag-lists-string": "red|blue", "diag-dicts-get": "2", "diag-dicts-length": "0",
  "diag-dicts-membership": "{'x': 2, 'y': 1}", "diag-classes-init": "Dog: Rex", "diag-classes-self": "blue",
  "diag-classes-instance": "2", "diag-pandas-missing": "{'age': 1}", "diag-pandas-dropna": "[10.0, 0.0, 12.0]",
  "diag-pandas-fillna": "[10, 0, 12]", "diag-sqlite-select": "blue, 1; red, 2", "diag-sqlite-where": "6",
  "diag-sqlite-count": "blue, 1; red, 2", "diag-csv-dictreader": "7", "diag-json-nested": "Ada", "diag-money-round": "Decimal",
  "diag-http-retry": "backoff reduces load", "diag-file-write": "append", "diag-llm-shape": "expected type",
};

describe("semantic diagnostic concept graders", () => {
  it("registers and grades every concept item", () => {
    const concepts = DIAGNOSTIC_ITEMS.filter(item => item.kind === "concept");
    for (const item of concepts) {
      expect(hasConceptGrader(item.id), item.id).toBe(true);
      expect(gradeDiagnosticConcept(item.id, answers[item.id] ?? "").correct, item.id).toBe(true);
      expect(gradeDiagnosticConcept(item.id, "banana").correct, item.id).toBe(false);
    }
  });

  it("understands a declared unknown and rejects negated or contradictory answers", () => {
    expect(gradeDiagnosticConcept("diag-csp-boolean", "I do not know").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-exc-catch", "no, do not catch it").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-exc-catch", "yes, but do not catch it").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-conditionals-compare", "False").correct).toBe(false);
  });
});
