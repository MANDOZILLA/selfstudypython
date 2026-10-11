import { describe, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { resolve } from "node:path";
import { missionTaskSchema } from "../lib/mission-types";
import { BASICS_REVIEW_TASKS } from "../curriculum/review-basics";
import { REVIEW_BASICS_CATALOG, REVIEW_BASICS_SUITES } from "../public/grading/review-suites-basics.js";

const references = [
  `def solve(item, count):\n    return f"{item} x {count}"\n`,
  `def solve(height):\n    if height < 20: return "short"\n    if height < 40: return "medium"\n    return "tall"\n`,
  `def solve(scores):\n    count = 0\n    for score in scores:\n        if score >= 5: count += 1\n    return count\n`,
  `def solve(names):\n    cleaned = []\n    for name in names:\n        cleaned.append(name.strip().lower())\n    return cleaned\n`,
  `def solve(colors):\n    counts = {}\n    for color in colors: counts[color] = counts.get(color, 0) + 1\n    return counts\n`,
  `class Book:\n    def __init__(self, title):\n        self.title = title\n        self.borrowed = False\n    def borrow(self):\n        self.borrowed = True\ndef solve(title, borrow_it):\n    book = Book(title)\n    if borrow_it: book.borrow()\n    return {"title": book.title, "borrowed": book.borrowed}\n`,
];

const mutants = [
  [`def solve(item, count):\n    return f"{item} x {count + 1}"\n`, `def solve(item, count):\n    return item\n`],
  [`def solve(height):\n    if height <= 20: return "short"\n    if height < 40: return "medium"\n    return "tall"\n`, `def solve(height):\n    if height < 20: return "short"\n    return "medium"\n`],
  [`def solve(scores):\n    count = 0\n    for score in scores:\n        if score > 5: count += 1\n    return count\n`, `def solve(scores):\n    return 0\n`],
  [`def solve(names):\n    return [name.lower() for name in names]\n`, `def solve(names):\n    return [name.strip() for name in names]\n`],
  [`def solve(colors):\n    counts = {}\n    for color in colors: counts[color] = 1\n    return counts\n`, `def solve(colors):\n    return {}\n`],
  [`class Book:\n    def __init__(self, title): self.title, self.borrowed = title, False\n    def borrow(self): pass\ndef solve(title, borrow_it):\n    book = Book(title)\n    if borrow_it: book.borrow()\n    return {"title": book.title, "borrowed": book.borrowed}\n`, `class Book:\n    def __init__(self, title): self.title, self.borrowed = title, False\n    def borrow(self): self.borrowed = True\ndef solve(title, borrow_it):\n    book = Book(title)\n    return {"title": book.title, "borrowed": book.borrowed}\n`],
];

describe("spaced review for beginner skills", () => {
  it("uses valid tasks and registered grader checks", () => {
    expect(BASICS_REVIEW_TASKS.map(task => task.id)).toEqual([
      "py-values-retrieval", "py-conditionals-retrieval", "py-loops-retrieval",
      "py-lists-strings-retrieval", "py-dicts-retrieval", "py-classes-retrieval",
    ]);
    expect(Object.keys(REVIEW_BASICS_SUITES)).toHaveLength(6);
    for (const task of BASICS_REVIEW_TASKS) {
      expect(missionTaskSchema.safeParse(task).success, task.id).toBe(true);
      const variant = task.variants[0];
      const entry = REVIEW_BASICS_CATALOG[variant.graderId as keyof typeof REVIEW_BASICS_CATALOG];
      expect(entry, variant.graderId).toBeDefined();
      expect(entry.exerciseId).toBe(variant.exerciseId);
      for (const checks of Object.values(variant.skillChecks)) for (const check of checks) expect(entry.requiredTests).toContain(check);
    }
  });

  it("passes references and rejects starters plus two plausible bugs in real Pyodide", async () => {
    const runtime = await loadPyodide({ indexURL: resolve("public/pyodide") });
    for (let index = 0; index < BASICS_REVIEW_TASKS.length; index++) {
      const task = BASICS_REVIEW_TASKS[index];
      const variant = task.variants[0];
      const graderId = variant.graderId as keyof typeof REVIEW_BASICS_SUITES;
      const required = REVIEW_BASICS_CATALOG[graderId].requiredTests;
      const suite = REVIEW_BASICS_SUITES[graderId];
      const run = async (source: string) => {
        const globals = runtime.toPy({ submission_source: source });
        try { return JSON.parse(await runtime.runPythonAsync(suite, { globals })) as { tests: { id: string; passed: boolean }[] }; }
        finally { globals.destroy(); }
      };
      const result = await run(references[index]);
      expect(result.tests.filter(test => required.includes(test.id)).every(test => test.passed), `${graderId} reference`).toBe(true);
      const starter = variant.starterFiles["main.py"];
      const starterResult = await run(starter);
      expect(starterResult.tests.some(test => !test.passed), `${graderId} starter`).toBe(true);
      for (const mutant of mutants[index]) {
        const mutantResult = await run(mutant);
        expect(mutantResult.tests.some(test => !test.passed), `${graderId} mutant`).toBe(true);
      }
    }
  }, 120000);
});
