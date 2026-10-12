import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("every code-reading item shows a runnable python block and records its exact output", () => {
    const concepts = DIAGNOSTIC_ITEMS.filter(item => item.kind === "concept");
    const explanations = concepts.filter(item => !item.concept?.expectedOutput).map(item => item.id).sort();
    expect(explanations).toEqual(["diag-csp-testing", "diag-file-write", "diag-http-429", "diag-http-timeout"]);
    for (const item of concepts.filter(item => item.concept?.expectedOutput)) {
      expect(item.prompt, item.id).toMatch(/```python\n[\s\S]+\n```$/);
    }
    // The first two items of every rung decide most placements: they must be code reading.
    for (const skill of skills) {
      const firstTwo = DIAGNOSTIC_ITEMS.filter(item => item.skillId === skill.id).slice(0, 2);
      for (const item of firstTwo) expect(item.kind === "coding" || !!item.concept?.expectedOutput, `${skill.id} ${item.id}`).toBe(true);
    }
  });

  it("the browser verifier's answer file matches the bank (UPDATE_DIAGNOSTIC_ANSWERS=1 regenerates it)", () => {
    const file = resolve("scripts/diagnostic-answers.json");
    const expected = Object.fromEntries(DIAGNOSTIC_ITEMS
      .filter(item => item.concept?.expectedOutput)
      .map(item => [/```python\n([\s\S]+)\n```$/.exec(item.prompt)![1], item.concept!.expectedOutput!]));
    if (process.env.UPDATE_DIAGNOSTIC_ANSWERS) writeFileSync(file, `${JSON.stringify(expected, null, 2)}\n`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(expected);
  });

  it("no two items ask the same question", () => {
    const prompts = DIAGNOSTIC_ITEMS.map(item => item.prompt);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it("grades exact code-reading answers and rejects plausible wrong values", () => {
    const cases: Record<string, [string, string, string, string]> = {
      "diag-values-print": ["hello", " hello ", "'hello'", "hello."],
      "diag-values-add": ["10", " 10 ", "73", "x + y"],
      "diag-values-fstring": ["Next year: 10", "Next year:10", "Next year: 9", "Next year: {age + 1}"],
      "diag-conditionals-compare": ["True", "true", "False", "yes"],
      "diag-conditionals-branch": ["mild", " mild ", "cold", "hot"],
      "diag-loops-final": ["6", " 6 ", "10", "3"],
      "diag-loops-break": ["5", " 5", "4", "9"],
      "diag-lists-first": ["['blue', 'green']", "[\"blue\",\"green\"]", "['red', 'blue']", "['blue']"],
      "diag-lists-append": ["[0, 2, 4]", "[0,2,4]", "[0 2 4]", "[0, 1, 2]"],
      "diag-lists-string": ["red|blue", " red|blue", "red,blue", "blue|red"],
      "diag-csp-abstraction": ["None", "none", "HI", "hi"],
      "diag-dicts-loop": ["7", " 7 ", "2", "tea pie"],
      "diag-dicts-membership": ["{'x': 2, 'y': 1}", "{\"x\":2,\"y\":1}", "{'x': 1, 'y': 2}", "{'x': 2}"],
      "diag-exc-finally": ["4", " 4 ", "3", "1"],
      "diag-exc-raise": ["bad age", "bad  age ", "ValueError", "x1"],
      "diag-exc-chain": ["ValueError", " ValueError ", "RuntimeError", "bad row"],
      "diag-file-readlines": ["2 False", "2, False", "2 True", "['a', 'b']"],
      "diag-classes-init": ["Dog: Rex", "Dog:Rex", "Dog: rex", "Rex"],
      "diag-classes-self": ["blue", "blue ", "green", "red"],
      "diag-ds-dict-get": ["7", " 7", "row.get('id')", "{'id': 7}"],
      "diag-ds-clean-value": ["['Ada', 'Lin']", "[\"Ada\", \"Lin\"]", "[' Ada ', 'Lin ']", "['Ada', 'Lin ']"],
      "diag-ds-sort-key": ["[2, 3, 1]", "[2,3,1]", "[1, 3, 2]", "[9, 5, 3]"],
      "diag-csv-quoted": ["2", " 2 ", "3", "one field"],
      "diag-csv-empty": ["4 []", "4, []", "3 []", "4 ['Lin']"],
      "diag-money-decimal": ["0.30", " 0.30 ", "0.3", "0.31"],
      "diag-money-negative": ["2.50", "2.50 ", "2.5", "7.50"],
      "diag-money-round": ["False True", "false, true", "True True", "False False"],
      "diag-json-envelope": ["True False", "True, False", "True True", "False False"],
      "diag-pandas-dropna": ["[10.0, 12.0]", "[10, 12]", "[10.0, 0.0, 12.0]", "[10.0, nan, 12.0]"],
      "diag-sqlite-count": ["[('blue', 1), ('red', 2)]", "[(\"blue\",1),(\"red\",2)]", "[('red', 2), ('blue', 1)]", "[('blue', 3), ('red', 6)]"],
      "diag-http-retry-after": ["False True", "False, True", "True True", "True False"],
      "diag-http-retry": ["[0.5, 1.0, 2.0, 4.0]", "[0.5,1.0,2.0,4.0]", "[0.5, 1, 2, 4]", "[1.0, 2.0, 4.0, 8.0]"],
      "diag-llm-deterministic": ["False", "false", "True", "spam"],
      "diag-llm-fallback": ["unknown unknown", "unknown, unknown", "eggs unknown", "unknown"],
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
  const explanations: Record<string, string> = {
    "diag-csp-testing": "boundary cases around 60", "diag-file-write": "ab",
    "diag-http-429": "no, back off", "diag-http-timeout": "timeout",
  };
  return DIAGNOSTIC_ITEMS.find(item => item.id === id)?.concept?.expectedOutput ?? explanations[id] ?? id;
}