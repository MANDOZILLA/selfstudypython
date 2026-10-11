/**
 * Semantic short-answer grading for the adaptive placement diagnostic's
 * concept items. Pure TypeScript — no DOM, no dependencies beyond the item
 * registry (used only to enumerate which ids have concept graders).
 *
 * Each item id maps to an item-specific semantic predicate. Deliberately
 * NOT keyword-bag scoring: predicates honor the gradingNotes on each item
 * (exact matches where the notes demand them, understood negation where
 * the notes demand it, and named equivalent phrasings otherwise).
 */
import { DIAGNOSTIC_ITEMS } from "../curriculum/diagnostic-items";
import { isUnknownDeclaration } from "./diagnostic";

export interface DiagnosticConceptResult {
  correct: boolean;
  detail: string;
}

type ConceptPredicate = (trimmed: string) => DiagnosticConceptResult;

/** Every id in DIAGNOSTIC_ITEMS whose kind is "concept". */
const CONCEPT_IDS: ReadonlySet<string> = new Set(
  DIAGNOSTIC_ITEMS.filter(item => item.kind === "concept").map(item => item.id),
);

/** True when `itemId` is a concept item with a semantic grader. */
export function hasConceptGrader(itemId: string): boolean {
  return CONCEPT_IDS.has(itemId);
}

const pass = (detail: string): DiagnosticConceptResult => ({ correct: true, detail });
const fail = (detail: string): DiagnosticConceptResult => ({ correct: false, detail });

/** Negation tokens: when these appear, an answer cannot be affirmative. */
const NEGATED = /\b(don'?t|do not|cannot|can'?t|won'?t|shouldn'?t|never|not|no)\b/i;
/** Affirmative tokens. */

const GRADERS: Record<string, ConceptPredicate> = {
  // Legacy beginner item ids are retained and graded as ordinary Python concepts.
  "diag-csp-loop-count": t =>
    t === "4" ? pass("range(4) runs the body four times: total is 4") : fail("expected exactly '4' (range(4) iterates four times)"),

  "diag-csp-boolean": t =>
    /\btrue\b/i.test(t) && !/\bfalse\b/i.test(t)
      ? pass("3 > 5 is False, so not (3 > 5) is True")
      : fail("expected 'True' (3 > 5 is False, not flips it)"),

  "diag-csp-branch": t =>
    /^['"]?pass['"]?$/.test(t)
      ? pass("72 >= 60 is True, so 'pass' prints")
      : fail("expected exactly 'pass' (72 >= 60 runs the if-branch)"),

  "diag-csp-variable": t =>
    t === "6" ? pass("count is reassigned to 1 + 5 = 6") : fail("expected exactly '6'"),

  "diag-csp-call": t =>
    t === "6" ? pass("double(3) returns 3 * 2 = 6") : fail("expected exactly '6' (double(3) returns 3 * 2)"),

  "diag-csp-index": t =>
    /^['"]?bee['"]?$/.test(t)
      ? pass("list positions start at 0, so items[1] is 'bee'")
      : fail("expected 'bee' (positions start at 0, so index 1 is the second element)"),

  "diag-csp-abstraction": t =>
    /\b(def|function|procedure|method|subroutine)\b/i.test(t)
      ? pass("naming a reusable block is abstraction via a function/procedure")
      : fail("expected a function/procedure (define it once with def, call it anywhere)"),

  "diag-csp-nested": t =>
    t === "6" ? pass("3 outer × 2 inner iterations = 6") : fail("expected exactly '6' (3 × 2 increments)"),

  "diag-csp-testing": t =>
    /(boundar|edge)/i.test(t) ||
    (/\b59\b/.test(t) && /\b60\b/.test(t)) ||
    (/\b60\b/.test(t) && /\b61\b/.test(t))
      ? pass("boundary cases around 60 give the most confidence")
      : fail("expected boundary/edge cases around 60 (e.g. 59, 60, 61)"),

  // ---- python-functions ----
  "diag-fn-return": t => /^['\"]?4['\"]?$/.test(t) ? pass("the helper returns 4") : fail("expected exactly 4"),

  "diag-fn-default-arg": t => /^['\"]?5['\"]?$/.test(t) ? pass("twice calls add twice to return 5") : fail("expected exactly 5"),

  // ---- python-exceptions ----
  "diag-exc-catch": t => /^0$/.test(t) ? pass("ValueError is caught and age becomes zero") : fail("expected exactly 0"),

  "diag-exc-bare": t => /^['\"]?caught['\"]?$/.test(t) ? pass("bare except catches ValueError") : fail("expected caught"),

  "diag-exc-finally": t => /^3$/.test(t) ? pass("finally prints the assigned value 3") : fail("expected exactly 3"),

  "diag-exc-raise": t => {
    // A negation that rejects the sentinel ("don't return -1") while the
    // answer affirms raising is correct; a negation that rejects raising
    // ("don't raise") is not.
    const raises = /\brais(e|ing)\b/i.test(t);
    const disclaimsReturn = /\b(don'?t|do not|never|not|no)\s+return(ing)?\s*-1\b/i.test(t);
    if (raises && !/\breturn(ing)?\s*-1\b/i.test(t)) return pass("raising makes the failure impossible to ignore");
    if (raises && disclaimsReturn) return pass("raising makes the failure impossible to ignore");
    return NEGATED.test(t)
      ? fail("negated answers are wrong")
      : fail("expected 'raise ValueError', not 'return -1'");
  },

  "diag-exc-chain": t =>
    /\boriginal\s+(exception|error)\b/i.test(t) ||
    /\bcause\b/i.test(t) ||
    /\bcontext\b/i.test(t) ||
    /\bfrom\s+err\b/i.test(t)
      ? pass("the original error's cause/context is preserved")
      : fail("expected the preserved original error (cause/context)"),

  // ---- data-structures ----
  "diag-ds-clean-value": t => {
    const parts = t.split(";");
    if (parts.length < 2) return fail("expected a compound answer: '<value>; <expression>'");
    const [valuePart, exprPart] = parts;
    const valueOk = /\bfalse\b/i.test(valuePart) && !/\btrue\b/i.test(valuePart);
    if (!valueOk) return fail("the value of clean is False");
    const exprOk = /\bname\s*\.\s*strip\s*\(\s*\)/.test(exprPart);
    if (!exprOk) return fail("the expression must call name.strip()");
    return pass("False; name.strip() — clean is False, cleaned name via strip");
  },

  "diag-ds-dict-get": t =>
    /\brow\s*\.\s*get\b/i.test(t)
      ? pass("row.get avoids KeyError")
      : fail("expected row.get('id')"),

  "diag-ds-comprehension": t =>
    /\blist\b/i.test(t) && !/\b(generator|none)\b/i.test(t)
      ? pass("a list comprehension builds a list")
      : fail("expected 'list'"),

  "diag-ds-mutation": t =>
    t.replace(/\s+/g, "") === "[1,2,3]"
      ? pass("b shares a's list, so a is [1, 2, 3]")
      : fail("expected '[1, 2, 3]' (shared reference)"),

  "diag-ds-sort-key": t =>
    /\b(sorted|sort)\b/i.test(t) && /\bkey\b/i.test(t) && /\bamount\b/i.test(t) && /\breverse\s*=\s*true/i.test(t)
      ? pass("sorted with a key on 'amount' and reverse=True")
      : fail("expected sorted()/sort with a key on 'amount' and reverse=True"),

  // ---- csv-cleaning ----
  "diag-csv-header": t => /^['\"]?ada['\"]?$/i.test(t) ? pass("the first data row has name Ada") : fail("expected Ada"),

  "diag-csv-strip": t => /^['\"]?ada['\"]?$/i.test(t) ? pass("strip removes surrounding spaces") : fail("expected Ada"),

  "diag-csv-quoted": t =>
    /\bone\s+field\b/i.test(t) && !/\btwo\b/i.test(t)
      ? pass("quotes protect the comma: one field")
      : fail("expected 'one field'"),

  "diag-csv-empty": t => /^['\"]?ada['\"]?$/i.test(t) ? pass("the first data cell is Ada") : fail("expected Ada"),

  // ---- json-validation ----
  "diag-json-loads": t =>
    /\blist\b/i.test(t) && !/\bdict\b/i.test(t)
      ? pass("json.loads('[1, 2]') returns a list")
      : fail("expected 'list'"),

  "diag-json-envelope": t =>
    /\bdict\b/i.test(t) && /\blist\b/i.test(t) && /\bpayments\b/i.test(t)
      ? pass("validate the envelope: dict with a 'payments' list")
      : fail("expected validation of the dict envelope and its 'payments' list"),

  "diag-json-decode-error": t =>
    /jsondecodeerror/i.test(t)
      ? pass("json.loads('{bad') raises JSONDecodeError")
      : fail("expected 'JSONDecodeError'"),

  "diag-json-types": t =>
    (/\bstrict\b/i.test(t) && /\btype\b/i.test(t)) ||
    (/\btruth(y|iness)\b/i.test(t) && /(\baccept\b|\breject\b|\btrue\b|\b1\b)/i.test(t))
      ? pass("strict type checks reject non-strings that truthiness accepts")
      : fail("expected strict type checking vs truthiness"),

  "diag-json-dumps": t =>
    /\bstr(ing)?\b/i.test(t) && !/\b(dict|bytes)\b/i.test(t)
      ? pass("json.dumps returns a string")
      : fail("expected 'string'"),

  // ---- financial-data ----
  "diag-money-decimal": t => /^['\"]?0\.30['\"]?$/.test(t) ? pass("Decimal adds exactly to 0.30") : fail("expected exactly 0.30"),

  "diag-money-quantize": t =>
    /^['\"]?1\.24['\"]?$/.test(t) ? pass("quantize rounds to 1.24") : fail("expected 1.24"),

  "diag-money-negative": t => /^true$/i.test(t) ? pass("negative amount is less than zero") : fail("expected True"),

  "diag-money-currency": t =>
    (/\bupper\b/i.test(t) || /\buppercase\b/i.test(t)) && !/\blower\b/i.test(t)
      ? pass("normalize with upper()")
      : fail("expected 'upper()'"),

  // ---- http-reliability ----
  "diag-http-retry-after": t => /^true$/i.test(t) ? pass("the retry delay is positive") : fail("expected True"),

  "diag-http-2xx": t => /^true$/i.test(t) ? pass("201 is in the 2xx range") : fail("expected True"),

  "diag-http-429": t =>
    /\b(no|wait|back\s*off)\b/i.test(t) && !/\byes\b/i.test(t)
      ? pass("do not retry immediately; wait / back off")
      : fail("expected 'no', with waiting/backing off"),

  "diag-http-timeout": t =>
    /\btimeout\b/i.test(t)
      ? pass("a timeout bounds how long you wait")
      : fail("expected 'timeout'"),

  // ---- file-io ----
  "diag-file-close": t => /^['\"]?ok['\"]?$/.test(t) ? pass("the file-like object contains ok") : fail("expected ok"),

  "diag-file-modes": t => /^['\"]?new['\"]?$/.test(t) ? pass("writing at the start replaces the old contents") : fail("expected new"),

  "diag-file-readlines": t =>
    /\blist\b/i.test(t) && !/\bstring\b/i.test(t)
      ? pass("readlines returns a list of lines")
      : fail("expected 'list'"),

  "diag-file-newline": t =>
    (/\\n/.test(t) || /\bnewline\b/i.test(t)) && /\b(r?strip)\b/i.test(t)
      ? pass("lines end with \\n, removed with strip/rstrip")
      : fail("expected the newline character and strip/rstrip"),

  // ---- llm-output-validation ----
  "diag-llm-schema": t =>
    /^['\"]?int['\"]?$/.test(t) ? pass("the parsed age has type int") : fail("expected int"),

  "diag-llm-deterministic": t =>
    /^false$/i.test(t) ? pass("the two outputs differ") : fail("expected False"),

  "diag-llm-fallback": t =>
    /\bfallback\b/i.test(t) && !/\b(guess|crash)\b/i.test(t)
      ? pass("use a deterministic fallback")
      : fail("expected the deterministic fallback"),

  "diag-values-type": t => /\b(float|decimal number)\b/i.test(t) ? pass("4.5 is a float") : fail("expected float"),
  "diag-values-reassign": t => /^6(?:\.0)?$/.test(t) ? pass("x is reassigned to 2 times 3") : fail("expected 6"),
  "diag-values-print": t => /^['\"]?hello['\"]?$/.test(t) ? pass("print displays hello") : fail("expected hello"),
  "diag-values-add": t => /^10(?:\.0)?$/.test(t) ? pass("7 plus 3 is 10") : fail("expected 10"),
  "diag-if-elif": t => /^['\"]?mid['\"]?$/.test(t) ? pass("the elif branch runs") : fail("expected mid"),
  "diag-conditionals-compare": t => /\btrue\b/i.test(t) && !/\bfalse\b/i.test(t) ? pass("4 is less than 9") : fail("expected True"),
  "diag-conditionals-branch": t => /\byes\b/i.test(t) && !/\bno\b/i.test(t) ? pass("the true branch prints yes") : fail("expected yes"),
  "diag-loops-sum": t => /^12$/.test(t) ? pass("2 plus 4 plus 6 is 12") : fail("expected 12"),
  "diag-loops-range": t => /^3$/.test(t) ? pass("range(3) has three values") : fail("expected 3"),
  "diag-loops-final": t => /^5$/.test(t) ? pass("the body adds 2 twice") : fail("expected 5"),
  "diag-lists-length": t => /^3$/.test(t) ? pass("the list has three items") : fail("expected 3"),
  "diag-lists-slice": t => /\[\s*20\s*,\s*30\s*\]/.test(t) ? pass("slice includes indexes 1 and 2") : fail("expected [20, 30]"),
  "diag-lists-first": t => /^\[\s*['\"]blue['\"]\s*,\s*['\"]green['\"]\s*\]$/.test(t) ? pass("the slice contains blue and green") : fail("expected ['blue', 'green']"),
  "diag-lists-string": t => /^['\"]?red\|blue['\"]?$/.test(t) ? pass("split and join produce red|blue") : fail("expected red|blue"),
  "diag-dicts-get": t => /^2$/.test(t) ? pass("a occurs twice") : fail("expected exactly 2"),
  "diag-dicts-length": t => /^0$/.test(t) ? pass("get returns its default for a missing key") : fail("expected exactly 0"),
  "diag-dicts-membership": t => /^\{\s*['\"]x['\"]\s*:\s*2\s*,\s*['\"]y['\"]\s*:\s*1\s*\}$/.test(t) ? pass("the loop counts x twice and y once") : fail("expected {'x': 2, 'y': 1}"),
  "diag-classes-init": t => /^['\"]?Dog:\s*Rex['\"]?$/.test(t) ? pass("describe returns Dog: Rex") : fail("expected Dog: Rex"),
  "diag-classes-self": t => /^['\"]?blue['\"]?$/.test(t) ? pass("b remains blue when a changes") : fail("expected blue"),
  "diag-classes-instance": t => /^2$/.test(t) ? pass("the counter was incremented twice") : fail("expected exactly 2"),
  "diag-pandas-missing": t => /^\{\s*['\"]age['\"]\s*:\s*1\s*\}$/.test(t) ? pass("one age value is missing") : fail("expected {'age': 1}"),
  "diag-pandas-dropna": t => /^\[\s*10(?:\.0)?\s*,\s*0(?:\.0)?\s*,\s*12(?:\.0)?\s*\]$/.test(t) ? pass("fillna replaces the missing value with zero") : fail("expected [10, 0, 12]"),
  "diag-pandas-fillna": t => /^\[\s*10(?:\.0)?\s*,\s*0(?:\.0)?\s*,\s*12(?:\.0)?\s*\]$/.test(t) ? pass("fillna replaces the missing value with zero") : fail("expected [10, 0, 12]"),
  "diag-sqlite-select": t => /^blue\s*[,;:]\s*1\s*;?\s*red\s*[,;:]\s*2$/i.test(t) ? pass("GROUP BY counts one blue and two red rows") : fail("expected blue, 1; red, 2"),
  "diag-sqlite-where": t => /^6$/.test(t) ? pass("the red quantities sum to six") : fail("expected exactly 6"),
  "diag-sqlite-count": t => /^blue\s*[,;:]\s*1\s*;?\s*red\s*[,;:]\s*2$/i.test(t) ? pass("GROUP BY counts one blue and two red rows") : fail("expected blue, 1; red, 2"),
  "diag-csv-dictreader": t => /^['\"]?7['\"]?$/.test(t) ? pass("DictReader values are text, so age is '7'") : fail("expected 7"),
  "diag-json-nested": t => /^['\"]?ada['\"]?$/i.test(t) ? pass("the nested name is Ada") : fail("expected Ada"),
  "diag-money-round": t => /\bdecimal\b/i.test(t) && !/\bfloat\b/i.test(t) ? pass("Decimal represents decimal money exactly") : fail("expected Decimal"),
  "diag-http-retry": t => /(back.?off|reduce.*load|less.*load|wait)/i.test(t) && !/\b(immediately|no wait)\b/i.test(t) ? pass("backoff reduces load") : fail("expected backoff or reduced load"),
  "diag-file-write": t => /\bappend(ing)?\b/i.test(t) && !/\boverwrite/i.test(t) ? pass("append mode adds to the end") : fail("expected append"),
  "diag-llm-shape": t => /(expected|correct|required)\s+(type|schema)|(type|schema).{0,30}(expected|correct|required)/i.test(t) ? pass("validate the expected type or schema") : fail("expected the type or schema check"),
};

/**
 * Grade a short-answer concept response against the item's semantic rule.
 * The explicit "I do not know" declaration is never a wrong answer: the
 * engine records it as a knowledge gap before grading, and if it reaches this
 * layer anyway it fails with a gap-specific detail, never a misconception one.
 * @throws Error("unknown diagnostic concept item ...") for unknown ids.
 */
export function gradeDiagnosticConcept(itemId: string, answer: string): DiagnosticConceptResult {
  const grader = GRADERS[itemId];
  if (!grader || !CONCEPT_IDS.has(itemId)) {
    throw new Error(`unknown diagnostic concept item ${itemId}`);
  }
  const trimmed = answer.trim();
  if (isUnknownDeclaration(trimmed)) {
    return { correct: false, detail: 'learner declared "I do not know" — knowledge gap, not a wrong answer' };
  }
  return grader(trimmed);
}
