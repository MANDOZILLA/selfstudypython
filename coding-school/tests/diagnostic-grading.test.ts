import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_ITEMS } from "../curriculum/diagnostic-items";
import {
  gradeDiagnosticConcept,
  hasConceptGrader,
} from "../lib/diagnostic-grading";

const conceptIds = DIAGNOSTIC_ITEMS.filter(i => i.kind === "concept").map(i => i.id);
const codingIds = DIAGNOSTIC_ITEMS.filter(i => i.kind === "coding").map(i => i.id);

describe("hasConceptGrader", () => {
  it("is true for every concept item in DIAGNOSTIC_ITEMS", () => {
    expect(conceptIds.length).toBeGreaterThan(0);
    for (const id of conceptIds) {
      expect(hasConceptGrader(id), `expected grader for ${id}`).toBe(true);
    }
  });

  it("is false for coding items and unknown ids", () => {
    expect(codingIds.length).toBeGreaterThan(0);
    for (const id of codingIds) {
      expect(hasConceptGrader(id), `expected no concept grader for ${id}`).toBe(false);
    }
    expect(hasConceptGrader("diag-nope-missing")).toBe(false);
    expect(hasConceptGrader("")).toBe(false);
  });
});

describe("gradeDiagnosticConcept — required cases", () => {
  it("diag-fn-isqrt-output: exactly '9' passes, 'ROOT(81)' fails", () => {
    expect(gradeDiagnosticConcept("diag-fn-isqrt-output", "9").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-isqrt-output", "  9  ").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-isqrt-output", "ROOT(81)").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-fn-isqrt-output", "9.0").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-fn-isqrt-output", "The answer is 9").correct).toBe(false);
  });

  it("diag-fn-loop-var: exactly 'x' passes, garbage fails", () => {
    expect(gradeDiagnosticConcept("diag-fn-loop-var", "x").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-loop-var", " x ").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-loop-var", "YTH").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-fn-loop-var", "y").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-fn-loop-var", "X").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-fn-loop-var", "the loop variable").correct).toBe(false);
  });

  it("diag-exc-catch: affirmative passes, negation fails", () => {
    expect(gradeDiagnosticConcept("diag-exc-catch", "yes").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-catch", "yes, catch it").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-catch", "Yes, definitely").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-catch", "don't catch ValueError").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-exc-catch", "do not catch").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-exc-catch", "no").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-exc-catch", "no, let it crash").correct).toBe(false);
  });

  it("diag-http-retry-after: affirmative passes, negation fails", () => {
    expect(gradeDiagnosticConcept("diag-http-retry-after", "yes").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-http-retry-after", "yes, wait 30s").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-http-retry-after", "don't wait for Retry-After").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-http-retry-after", "do not wait").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-http-retry-after", "no").correct).toBe(false);
  });

  it("diag-ds-clean-value: compound 'False; name = name.strip()' passes", () => {
    expect(gradeDiagnosticConcept("diag-ds-clean-value", "False; name = name.strip()").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-clean-value", "false; name.strip()").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-clean-value", "clean is false; name = name.strip()").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-clean-value", "True; name.strip()").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-ds-clean-value", "False").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-ds-clean-value", "False; name").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-ds-clean-value", "False; strip()").correct).toBe(false);
  });
});

describe("gradeDiagnosticConcept — unknown ids", () => {
  it("throws for unknown ids", () => {
    expect(() => gradeDiagnosticConcept("diag-nope-missing", "yes"))
      .toThrowError(/unknown diagnostic concept item/);
    expect(() => gradeDiagnosticConcept("", "yes")).toThrowError(/unknown diagnostic concept item/);
  });
});

describe("gradeDiagnosticConcept — other concept items", () => {
  it("diag-fn-return: the value of total", () => {
    expect(gradeDiagnosticConcept("diag-fn-return", "the value of total").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-return", "total").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-return", "returns total").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-return", "printed text").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-fn-return", "the print output").correct).toBe(false);
  });

  it("diag-fn-default-arg: shared mutable default", () => {
    expect(gradeDiagnosticConcept("diag-fn-default-arg", "the default list is created once and shared across calls").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-default-arg", "mutable default persists").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-default-arg", "evaluated once").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-default-arg", "because python is slow").correct).toBe(false);
  });

  it("diag-exc-finally: 'finally'", () => {
    expect(gradeDiagnosticConcept("diag-exc-finally", "finally").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-finally", "the finally block").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-finally", "except").correct).toBe(false);
  });

  it("diag-exc-raise: raise ValueError", () => {
    expect(gradeDiagnosticConcept("diag-exc-raise", "raise ValueError").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-raise", "raise").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-raise", "return -1").correct).toBe(false);
  });

  it("diag-exc-chain: original exception preserved", () => {
    expect(gradeDiagnosticConcept("diag-exc-chain", "it preserves the original exception").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-chain", "the cause").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-chain", "context").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-chain", "nothing important").correct).toBe(false);
  });

  it("diag-exc-bare: catches everything", () => {
    expect(gradeDiagnosticConcept("diag-exc-bare", "it catches everything including unexpected bugs").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-bare", "it hides real errors").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-bare", "because indentation").correct).toBe(false);
  });

  it("diag-ds-dict-get: row.get", () => {
    expect(gradeDiagnosticConcept("diag-ds-dict-get", "row.get('id')").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-dict-get", "row.get").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-dict-get", "row['id']").correct).toBe(false);
  });

  it("diag-ds-comprehension: list", () => {
    expect(gradeDiagnosticConcept("diag-ds-comprehension", "list").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-comprehension", "a list").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-comprehension", "generator").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-ds-comprehension", "None").correct).toBe(false);
  });

  it("diag-ds-mutation: [1, 2, 3]", () => {
    expect(gradeDiagnosticConcept("diag-ds-mutation", "[1, 2, 3]").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-mutation", "[1,2,3]").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-mutation", "[1, 2]").correct).toBe(false);
  });

  it("diag-ds-sort-key: sorted with key and reverse", () => {
    expect(gradeDiagnosticConcept("diag-ds-sort-key", "sorted(records, key=lambda r: r['amount'], reverse=True)").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-sort-key", "sort by amount").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-ds-sort-key", "sorted(records)").correct).toBe(false);
  });

  it("diag-csv-header: header row", () => {
    expect(gradeDiagnosticConcept("diag-csv-header", "the header row").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-csv-header", "headers").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-csv-header", "column position").correct).toBe(false);
  });

  it("diag-csv-strip: strip", () => {
    expect(gradeDiagnosticConcept("diag-csv-strip", "strip").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-csv-strip", ".strip()").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-csv-strip", "strip whitespace").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-csv-strip", "int()").correct).toBe(false);
  });

  it("diag-csv-quoted: one field", () => {
    expect(gradeDiagnosticConcept("diag-csv-quoted", "one field").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-csv-quoted", "as one field").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-csv-quoted", "two").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-csv-quoted", "two fields").correct).toBe(false);
  });

  it("diag-csv-empty: rejected", () => {
    expect(gradeDiagnosticConcept("diag-csv-empty", "rejected").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-csv-empty", "the row should be rejected").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-csv-empty", "kept with amount 0").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-csv-empty", "kept").correct).toBe(false);
  });

  it("diag-json-loads: list", () => {
    expect(gradeDiagnosticConcept("diag-json-loads", "list").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-json-loads", "a list").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-json-loads", "dict").correct).toBe(false);
  });

  it("diag-json-envelope: dict with payments list", () => {
    expect(gradeDiagnosticConcept("diag-json-envelope", "check it is a dict and payments is a list").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-json-envelope", "verify the payload is a dict with a payments list").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-json-envelope", "just loop over it").correct).toBe(false);
  });

  it("diag-json-decode-error: JSONDecodeError", () => {
    expect(gradeDiagnosticConcept("diag-json-decode-error", "JSONDecodeError").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-json-decode-error", "json.JSONDecodeError").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-json-decode-error", "ValueError").correct).toBe(false);
  });

  it("diag-json-types: strict type check", () => {
    expect(gradeDiagnosticConcept("diag-json-types", "strict type checking rejects True which truthiness accepts").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-json-types", "truthiness would accept True as an id").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-json-types", "truthiness is fine").correct).toBe(false);
  });

  it("diag-json-dumps: string", () => {
    expect(gradeDiagnosticConcept("diag-json-dumps", "a string").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-json-dumps", "str").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-json-dumps", "a dict").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-json-dumps", "bytes").correct).toBe(false);
  });

  it("diag-money-decimal: float inexactness", () => {
    expect(gradeDiagnosticConcept("diag-money-decimal", "binary floating-point is inexact, 0.1 + 0.2 is not 0.3").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-money-decimal", "float rounding errors").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-money-decimal", "because decimals are prettier").correct).toBe(false);
  });

  it("diag-money-quantize: quantize", () => {
    expect(gradeDiagnosticConcept("diag-money-quantize", "quantize(Decimal('0.01'))").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-money-quantize", "use quantize").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-money-quantize", "round()").correct).toBe(false);
  });

  it("diag-money-negative: rejected", () => {
    expect(gradeDiagnosticConcept("diag-money-negative", "rejected").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-money-negative", "it should be rejected").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-money-negative", "accepted").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-money-negative", "converted to 5.00").correct).toBe(false);
  });

  it("diag-money-currency: upper", () => {
    expect(gradeDiagnosticConcept("diag-money-currency", "upper()").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-money-currency", "uppercase it").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-money-currency", "lower()").correct).toBe(false);
  });

  it("diag-http-2xx: 2xx", () => {
    expect(gradeDiagnosticConcept("diag-http-2xx", "2xx").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-http-2xx", "the 2xx family").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-http-2xx", "3xx").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-http-2xx", "1xx").correct).toBe(false);
  });

  it("diag-http-429: no, back off", () => {
    expect(gradeDiagnosticConcept("diag-http-429", "no, back off and wait").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-http-429", "no, respect Retry-After").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-http-429", "yes").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-http-429", "yes, retry immediately").correct).toBe(false);
  });

  it("diag-http-timeout: timeout", () => {
    expect(gradeDiagnosticConcept("diag-http-timeout", "timeout").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-http-timeout", "set a timeout").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-http-timeout", "retry").correct).toBe(false);
  });

  it("diag-file-close: file is closed", () => {
    expect(gradeDiagnosticConcept("diag-file-close", "the file is closed").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-file-close", "closes the file even on error").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-file-close", "it reads the file").correct).toBe(false);
  });

  it("diag-file-modes: overwrites", () => {
    expect(gradeDiagnosticConcept("diag-file-modes", "overwrites it").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-file-modes", "truncates").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-file-modes", "appends to it").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-file-modes", "raises an error").correct).toBe(false);
  });

  it("diag-file-readlines: list", () => {
    expect(gradeDiagnosticConcept("diag-file-readlines", "list").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-file-readlines", "a list of lines").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-file-readlines", "a string").correct).toBe(false);
  });

  it("diag-file-newline: newline and strip", () => {
    expect(gradeDiagnosticConcept("diag-file-newline", "lines end with \\n, remove with rstrip()").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-file-newline", "newline character, strip it").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-file-newline", "comma, split it").correct).toBe(false);
  });

  it("diag-llm-schema: parse and validate", () => {
    expect(gradeDiagnosticConcept("diag-llm-schema", "parse and validate against a schema").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-llm-schema", "parse it then validate").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-llm-schema", "just read the fields").correct).toBe(false);
  });

  it("diag-llm-deterministic: nondeterminism", () => {
    expect(gradeDiagnosticConcept("diag-llm-deterministic", "model output is nondeterministic, shapes differ between calls").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-llm-deterministic", "the same prompt can produce different shapes").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-llm-deterministic", "because JSON is slow").correct).toBe(false);
  });

  it("diag-llm-fallback: deterministic fallback", () => {
    expect(gradeDiagnosticConcept("diag-llm-fallback", "use a deterministic fallback").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-llm-fallback", "fallback").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-llm-fallback", "crash").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-llm-fallback", "guess the fields").correct).toBe(false);
  });

describe("gradeDiagnosticConcept — wording false negatives (regression)", () => {
  it("diag-fn-return: 'the returned value' is a correct answer", () => {
    expect(gradeDiagnosticConcept("diag-fn-return", "result holds the returned value").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-return", "it returns the value to the caller").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-return", "the value of total").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-fn-return", "printed text").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-fn-return", "the print output").correct).toBe(false);
  });

  it("diag-exc-raise: negating 'return -1' while affirming 'raise' is correct", () => {
    expect(gradeDiagnosticConcept("diag-exc-raise", "Don't return -1, raise ValueError instead").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-raise", "do not return -1; raise instead").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-raise", "raise ValueError").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-exc-raise", "return -1").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-exc-raise", "don't raise, return -1").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-exc-raise", "returning -1 is fine").correct).toBe(false);
  });

  it("diag-ds-sort-key: sort with key and reverse=True, no parens needed", () => {
    expect(gradeDiagnosticConcept("diag-ds-sort-key", "sort the records with a key on 'amount' and reverse=True").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-sort-key", "use list.sort with key=lambda r: r['amount'], reverse=True").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-sort-key", "sorted(records, key=lambda r: r['amount'], reverse=True)").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-ds-sort-key", "sort by amount").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-ds-sort-key", "sorted(records)").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-ds-sort-key", "max of amount").correct).toBe(false);
  });

  it("diag-json-types: 'truthy' counts like 'truthiness'", () => {
    expect(gradeDiagnosticConcept("diag-json-types", "Because True is truthy but isn't a string, so a truthy check would accept it").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-json-types", "strict type checking rejects True which truthiness accepts").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-json-types", "truthiness is fine").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-json-types", "just check truthiness").correct).toBe(false);
  });

  it("diag-llm-deterministic: 'different results' and 'vary' convey nondeterminism", () => {
    expect(gradeDiagnosticConcept("diag-llm-deterministic", "the same prompt can give different results on different calls").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-llm-deterministic", "the output can vary from call to call").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-llm-deterministic", "model output is nondeterministic, shapes differ between calls").correct).toBe(true);
    expect(gradeDiagnosticConcept("diag-llm-deterministic", "because JSON is slow").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-llm-deterministic", "because it is deterministic").correct).toBe(false);
  });
});

  it("returns a detail string for every grade", () => {
    for (const id of conceptIds) {
      const r = gradeDiagnosticConcept(id, "some answer");
      expect(typeof r.detail).toBe("string");
      expect(r.detail.length).toBeGreaterThan(0);
    }
  });
});
