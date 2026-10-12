import { describe, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { resolve } from "node:path";
import { missionDefinitionSchema } from "../lib/mission-types";
import { MISSIONS_BASICS_2 } from "../curriculum/missions-basics-2";
import { BASICS_2_CATALOG, BASICS_2_SUITES } from "../public/grading/mission-suites-basics-2.js";
import { aggregateResult } from "../public/grading/protocol.js";

const refs = [
      `def is_even(number=0):\n    return number % 2 == 0\ndef solve(numbers):\n    if type(numbers) is not list: return 0\n    total = 0\n    for number in numbers:\n        if is_even(number): total += 1\n    return total\n`,
  `def average(scores):\n    return sum(scores)/len(scores) if scores else 0\ndef letter_grade(score):\n    if score >= 90: return 'A'\n    if score >= 80: return 'B'\n    if score >= 70: return 'C'\n    if score >= 60: return 'D'\n    return 'F'\ndef solve(scores):\n    if type(scores) is not list or any(type(x) not in (int,float) for x in scores) or not scores: return {'average':0.0,'letter':'N/A'}\n    avg = average(scores)\n    return {'average':avg,'letter':letter_grade(avg)}\n`,
  `import string\ndef solve(text):\n    if type(text) is not str: return {}\n    counts = {}\n    for word in text.lower().split():\n        word = word.strip(string.punctuation)\n        if word: counts[word] = counts.get(word, 0) + 1\n    return counts\n`,
  `def solve(rows):\n    totals = {}\n    if type(rows) is not list: return totals\n    for row in rows:\n        if type(row) is not tuple or len(row) != 2: continue\n        name, quantity = row\n        if type(name) is not str or not name.strip() or type(quantity) is not int or quantity < 0: continue\n        totals[name] = totals.get(name, 0) + quantity\n    return totals\n`,
  `class BankAccount:\n    def __init__(self, owner, balance=0): self.owner, self.balance = owner, balance\n    def deposit(self, amount): self.balance += amount; return self.balance\n    def withdraw(self, amount):\n        if amount > self.balance: return False\n        self.balance -= amount; return self.balance\ndef solve(operations):\n    accounts = {}\n    if type(operations) is not list: return {}\n    for owner, opening, actions in operations:\n        account = BankAccount(owner, opening)\n        for action, amount in actions:\n            if action == 'deposit': account.deposit(amount)\n            elif action == 'withdraw': account.withdraw(amount)\n        accounts[owner] = account.balance\n    return accounts\n`,
  `class Inventory:\n    def __init__(self): self.stock = {}\n    def add(self, name, quantity):\n        if type(name) is str and name.strip() and type(quantity) is int and quantity > 0: self.stock[name] = self.stock.get(name, 0) + quantity\n    def remove(self, name, quantity):\n        if type(quantity) is int and quantity > 0 and self.stock.get(name, 0) >= quantity:\n            self.stock[name] -= quantity\n            if self.stock[name] == 0: del self.stock[name]\n    def items(self): return dict(self.stock)\ndef solve(commands):\n    inventory = Inventory()\n    if type(commands) is not list: return {}\n    for command in commands:\n        if type(command) is not tuple or len(command) != 3: continue\n        action, name, quantity = command\n        if action == 'add': inventory.add(name, quantity)\n        elif action == 'remove': inventory.remove(name, quantity)\n    return inventory.items()\n`,
];

describe("beginner missions 5, 6, and 9", () => {
  it("matches the mission schema, prerequisites, and local grader catalog", () => {
    expect(MISSIONS_BASICS_2.map(m => m.id)).toEqual(["functions-first", "dictionaries", "classes-objects"]);
    expect(MISSIONS_BASICS_2.map(m => m.prerequisites)).toEqual([["lists-and-strings"], ["functions-first"], ["validation-functions"]]);
    for (const mission of MISSIONS_BASICS_2) expect(missionDefinitionSchema.safeParse(mission).success, mission.id).toBe(true);
    for (const mission of MISSIONS_BASICS_2) for (const stage of mission.stages) for (const task of stage.tasks) for (const variant of task.variants) {
      if (!variant.graderId) continue;
      const entry = BASICS_2_CATALOG[variant.graderId as keyof typeof BASICS_2_CATALOG];
      expect(entry, variant.graderId).toBeDefined();
      expect(entry.exerciseId).toBe(variant.exerciseId);
      for (const ids of Object.values(variant.skillChecks)) for (const id of ids) expect(entry.requiredTests).toContain(id);
    }
  });

  it("passes each reference and rejects its starter and two plausible bugs in real Pyodide", async () => {
    const runtime = await loadPyodide({ indexURL: resolve("public/pyodide") });
    const graderIds = Object.keys(BASICS_2_SUITES);
    expect(graderIds).toHaveLength(6);
    const bugs = [
      refs[0].replace("number % 2 == 0", "number % 2 == 1"),
      refs[1].replace("avg = average(scores)", "avg = 0"),
      refs[2].replace("counts.get(word, 0) + 1", "1"),
      refs[3].replace("totals.get(name, 0) + quantity", "quantity"),
      refs[4].replace("self.balance -= amount", "self.balance += amount"),
      refs[5].replace("self.stock.get(name, 0) >= quantity", "self.stock.get(name, 0) > quantity"),
    ];
    const secondBugs = [
      refs[0].replace("number % 2 == 0", "True"),
      refs[1].replace("score >= 90", "score >= 100"),
      refs[2].replace("text.lower()", "text.upper()"),
      refs[3].replace("quantity < 0", "quantity < -1"),
      refs[4].replace("if amount > self.balance:", "if False:"),
      refs[5].replace("if self.stock[name] == 0: del self.stock[name]", "if self.stock[name] == 0: pass"),
    ];
    // [ref index, find, replace]: bugs the original 1-2 inputs per check let through (each verified to pass the old grader).
    const moreBugs: [number, string, string][] = [
      [0,"return number % 2 == 0","return number % 2 == 0 and number < 9"],
      [0,"return number % 2 == 0","return number % 2 == 0 and number >= -2"],
      [1,"if score >= 60: return 'D'","if score > 60: return 'D'"],
      [1,"    return 'F'","    return 'D'"],
      [2,"text.lower().split()","text.lower().split(' ')"],
      [2,"counts[word] = counts.get(word, 0) + 1","counts[word] = min(counts.get(word, 0) + 1, 2)"],
      [3,"quantity < 0","quantity < 1"],
      [3," or not name.strip()",""],
      [4,"if amount > self.balance:","if amount >= self.balance:"],
      [4,"        account = BankAccount(owner, opening)","        if not actions: continue\n        account = BankAccount(owner, opening)"],
      [5,"self.stock.get(name, 0) >= quantity:\n            self.stock[name] -= quantity\n            if self.stock[name] == 0: del self.stock[name]","self.stock.get(name, 0) > 0:\n            self.stock[name] -= quantity\n            if self.stock[name] <= 0: del self.stock[name]"],
      [5,"type(quantity) is int and quantity > 0: self.stock[name]","type(quantity) is int and quantity >= 0: self.stock[name]"],
    ];
    for (let index = 0; index < graderIds.length; index++) {
      const graderId = graderIds[index];
      const entry = BASICS_2_CATALOG[graderId as keyof typeof BASICS_2_CATALOG];
      const suite = BASICS_2_SUITES[graderId as keyof typeof BASICS_2_SUITES];
      const run = async (source: string) => {
        const globals = runtime.toPy({ submission_source: source });
        try { return JSON.parse(await runtime.runPythonAsync(suite, { globals })) as { tests: { id: string; passed: boolean }[] }; }
        finally { globals.destroy(); }
      };
      const result = await run(refs[index]);
      expect(result.tests.filter(t => entry.requiredTests.includes(t.id)).every(t => t.passed), `${graderId} reference`).toBe(true);
      expect(aggregateResult({ requestId: "t", exerciseId: entry.exerciseId, graderId }, result).passed, `${graderId} reference via protocol`).toBe(true);
      const mission = MISSIONS_BASICS_2.find(m => m.stages.some(s => s.tasks.some(t => t.variants.some(v => v.graderId === graderId))))!;
      const starter = mission.stages.flatMap(s => s.tasks).flatMap(t => t.variants).find(v => v.graderId === graderId)!.starterFiles["main.py"];
      const starterResult = await run(starter);
      expect(starterResult.tests.some(t => !t.passed), `${graderId} starter`).toBe(true);
      const extra = moreBugs.filter(([at]) => at === index).map(([, find, replace]) => {
        expect(refs[index].includes(find), `${graderId} mutant applies`).toBe(true);
        return refs[index].replace(find, replace);
      });
      for (const mutant of [bugs[index], secondBugs[index], ...extra]) {
        const mutated = await run(mutant);
        expect(mutated.tests.some(t => !t.passed), `${graderId} mutant`).toBe(true);
      }
    }
  }, 120000);
});
