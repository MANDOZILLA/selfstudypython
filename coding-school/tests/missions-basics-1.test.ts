import { beforeAll, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { resolve } from "node:path";
import { MISSIONS_BASICS_1, BASICS_1_REVIEW_TASKS } from "../curriculum/missions-basics-1";
import { missionDefinitionSchema } from "../lib/mission-types";
import { BASICS_1_CATALOG, BASICS_1_SUITES } from "../public/grading/mission-suites-basics-1.js";
import { aggregateResult } from "../public/grading/protocol.js";

let runtime: Awaited<ReturnType<typeof loadPyodide>>;
beforeAll(async () => { runtime = await loadPyodide({ indexURL: resolve("public/pyodide") }); }, 60000);

for (const mission of MISSIONS_BASICS_1) {
  it(`validates ${mission.id} and its grader registrations`, () => {
    const parsed = missionDefinitionSchema.safeParse(mission);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    for (const stage of mission.stages) for (const task of stage.tasks) for (const variant of task.variants) {
      if (!variant.graderId) continue;
      const catalog = BASICS_1_CATALOG[variant.graderId];
      expect(catalog).toBeDefined();
      expect(catalog.exerciseId).toBe(variant.exerciseId);
      for (const checks of Object.values(variant.skillChecks)) for (const id of checks) expect(catalog.requiredTests).toContain(id);
    }
  });
}

const cases = [
  { id: "first-steps-guided-v1", starter: "def solve(name, age):\n    return \"\"\n", reference: "def solve(name, age):\n    return f\"Hi {name}, next year you will be {age + 1}\"\n", mutants: ["def solve(name, age):\n    return f\"Hi {name}, next year you will be {age}\"\n", "def solve(name, age):\n    return f\"Hi {name}, next year you will be {age + 2}\"\n"] },
  { id: "first-steps-project-v1", starter: "def solve(item, price, count):\n    return \"\"\n", reference: "def solve(item, price, count):\n    return f\"{item}: {count} x ${price:.2f} = ${price * count:.2f}\"\n", mutants: ["def solve(item, price, count):\n    return f\"{item}: {count} x ${price:.2f} = ${price + count:.2f}\"\n", "def solve(item, price, count):\n    return f\"{item}: {count} x ${price:.1f} = ${price * count:.1f}\"\n"] },
  { id: "making-decisions-guided-v1", starter: "def solve(temp):\n    return \"\"\n", reference: "def solve(temp):\n    if temp < 10: return \"cold\"\n    if temp < 25: return \"mild\"\n    return \"hot\"\n", mutants: ["def solve(temp):\n    if temp <= 10: return \"cold\"\n    if temp < 25: return \"mild\"\n    return \"hot\"\n", "def solve(temp):\n    if temp < 10: return \"cold\"\n    if temp <= 25: return \"mild\"\n    return \"hot\"\n"] },
  { id: "making-decisions-project-v1", starter: "def solve(age, is_student):\n    return 0\n", reference: "def solve(age, is_student):\n    if age < 5: return 0\n    if age < 18: return 8\n    if is_student: return 9\n    return 12\n", mutants: ["def solve(age, is_student):\n    if age <= 5: return 0\n    if age < 18: return 8\n    if is_student: return 9\n    return 12\n", "def solve(age, is_student):\n    if age < 5: return 0\n    if age < 18: return 8\n    if is_student: return 12\n    return 12\n"] },
  { id: "loops-guided-v1", starter: "def solve(n):\n    total = 0\n    return total\n", reference: "def solve(n):\n    total = 0\n    for x in range(1, n + 1): total += x\n    return total\n", mutants: ["def solve(n):\n    total = 0\n    for x in range(1, n): total += x\n    return total\n", "def solve(n):\n    total = 0\n    for x in range(1, n + 1): total += x + 1\n    return total\n"] },
  { id: "loops-project-v1", starter: "def solve(n):\n    return []\n", reference: "def solve(n):\n    out = []\n    for x in range(1, n + 1):\n        if x % 15 == 0: out.append(\"FizzBuzz\")\n        elif x % 3 == 0: out.append(\"Fizz\")\n        elif x % 5 == 0: out.append(\"Buzz\")\n        else: out.append(str(x))\n    return out\n", mutants: ["def solve(n):\n    out = []\n    for x in range(1, n + 1):\n        if x % 3 == 0: out.append(\"Fizz\")\n        elif x % 5 == 0: out.append(\"Buzz\")\n        elif x % 15 == 0: out.append(\"FizzBuzz\")\n        else: out.append(str(x))\n    return out\n", "def solve(n):\n    out = []\n    for x in range(1, n + 1): out.append(str(x))\n    return out\n"] },
  { id: "lists-and-strings-guided-v1", starter: "def solve(names):\n    return []\n", reference: "def solve(names):\n    result = []\n    for name in names:\n        cleaned = name.strip()\n        if cleaned: result.append(cleaned)\n    return result\n", mutants: ["def solve(names):\n    return [name for name in names if name]\n", "def solve(names):\n    return [name.strip().lower() for name in names if name.strip()]\n"] },
  { id: "lists-and-strings-project-v1", starter: "def solve(sentence):\n    return {\"text\": \"\", \"words\": [], \"count\": 0, \"unique\": 0}\n", reference: "def solve(sentence):\n    text = sentence.strip()\n    words = [word.lower() for word in text.split()]\n    return {\"text\": text, \"words\": words, \"count\": len(words), \"unique\": len(set(words))}\n", mutants: ["def solve(sentence):\n    text = sentence.strip()\n    words = [word.lower() for word in text.split()]\n    return {\"text\": text, \"words\": words, \"count\": len(words), \"unique\": len(words)}\n", "def solve(sentence):\n    text = sentence.strip()\n    words = [word for word in text.split()]\n    return {\"text\": text, \"words\": words, \"count\": len(words), \"unique\": len(set(words))}\n"] },
];

async function grade(source: string, graderId: string) {
  const namespace = runtime.toPy({ submission_source: source });
  try {
    const raw = await runtime.runPythonAsync(BASICS_1_SUITES[graderId], { globals: namespace });
    return JSON.parse(String(raw)) as { executionOk: boolean; tests: { id: string; passed: boolean }[] };
  } finally { namespace.destroy(); }
}

for (const item of cases) {
  it(`${item.id} accepts the reference and rejects starter plus two bugs`, async () => {
    const catalog = BASICS_1_CATALOG[item.id];
    expect(catalog).toBeDefined();
    const result = await grade(item.reference, item.id);
    expect(result.executionOk).toBe(true);
    expect(result.tests.filter(check => catalog.requiredTests.includes(check.id) && check.passed), JSON.stringify(result.tests)).toHaveLength(catalog.requiredTests.length);
    // The browser protocol rejects duplicate or missing check ids, so the reference must survive it too.
    expect(aggregateResult({ requestId: "t", exerciseId: catalog.exerciseId, graderId: item.id }, result).passed, JSON.stringify(result.tests)).toBe(true);
    for (const source of [item.starter, ...item.mutants]) {
      const bad = await grade(source, item.id);
      expect(bad.executionOk && bad.tests.every(check => check.passed)).toBe(false);
    }
  });
}

it("starts the first mission with an empty review and exports no unrelated review tasks", () => {
  expect(BASICS_1_REVIEW_TASKS).toEqual([]);
  expect(MISSIONS_BASICS_1[0].stages[0].tasks).toEqual([]);
});
