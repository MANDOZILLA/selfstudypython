import { beforeAll, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { resolve } from "node:path";
import { runSubmission } from "../public/grading/runner.js";
import { diagnosticItems } from "../curriculum/diagnostic";
let runtime: Awaited<ReturnType<typeof loadPyodide>>;
beforeAll(async () => { runtime = await loadPyodide({ indexURL: resolve("public/pyodide") }); }, 60000);
const references: Record<string, string> = {
  variables: "def solve(value): return int(value)*2",
  strings: "def solve(value): return value.strip().lower().replace(' ', '-')",
  conditionals: "def solve(value): return 0 if value >= 50 else 3 if value >= 20 else 5",
  loops: "def solve(value): return sum(sum(row) for row in value)",
  functions: "def solve(value): return value[0] + sum(value[1])",
  collections: "def solve(value):\n    groups = {}\n    for name, tag in value: groups.setdefault(name, set()).add(tag)\n    return {name: len(tags) for name, tags in groups.items()}",
  exceptions: "def solve(value):\n    result=[]\n    for text in value:\n        try: result.append(int(text))\n        except ValueError: continue\n    return result",
  reasoning: "def solve(value): return [value]",
  comprehensions: "def solve(value): return [n*n for n in value if n>0]",
  modules: "from math import ceil as up\ndef solve(value): return [up(n) for n in value]",
  files: "def solve(value):\n    with open(value, encoding='utf-8') as f: return [s.strip() for s in f if s.strip()]",
  "csv-json": "import json\ndef solve(value): return [r['name'] for r in json.loads(value)]",
  classes: "class Counter:\n    def __init__(self, start=0): self.value=start\n    def increment(self):\n        self.value+=1\n        return self.value\ndef solve(value):\n    c=Counter(value)\n    c.increment()\n    c.increment()\n    return c.value",
  http: "def solve(value):\n    if 200<=value['status']<300: return value['payload']\n    if value['status']==404: return None\n    raise ValueError('status')",
  data: "def solve(value):\n    result={}\n    for row in value: result[row['category']]=result.get(row['category'],0)+row['amount']\n    return result",
};
async function grade(skill: string, source: string) { return runSubmission({ type: "run", requestId: "diagnostic-test", exerciseId: `${skill}-code`, graderId: `diag-${skill}-v1`, files: {"main.py": source} }, async () => runtime); }
it.each(Object.entries(references))("executes the %s contract and rejects starter/print/hardcoded answers", async (skill, source) => {
  expect((await grade(skill, source)).passed).toBe(true);
  for (const wrong of ["def solve(value): pass", "print('all checks passed')", "def solve(value): return 0"])
    expect((await grade(skill, wrong)).passed).toBe(false);
});
it("rejects marker comprehensions and mutation/state leakage", async () => {
  expect((await grade("comprehensions", "def solve(value):\n    unused=[n for n in []]\n    result=[]\n    for n in value:\n        if n>0: result.append(n*n)\n    return result")).passed).toBe(false);
  expect((await grade("functions", "def solve(value):\n    total=value[0]\n    while value[1]: total+=value[1].pop()\n    return total")).passed).toBe(false);
  expect((await grade("reasoning", "def solve(value, saved=[]):\n    saved.append(value)\n    return saved")).passed).toBe(false);
});
it("requires executed module parsing/rounding and a closed file, not unused imports",async()=>{
  expect((await grade("modules","import math\ndef solve(value): return [int(n) if int(n)==n else int(n)+(n>0) for n in value]")).passed).toBe(false);
  expect((await grade("csv-json","import json, ast\ndef solve(value): return [r['name'] for r in ast.literal_eval(value)]")).passed).toBe(false);
  expect((await grade("files","from contextlib import nullcontext\ndef solve(value):\n    with nullcontext(): return [s.strip() for s in open(value,encoding='utf-8') if s.strip()]")).passed).toBe(false);
});
it("every canonical coding item has a passing executable contract", () => {
  expect(diagnosticItems.filter(i=>i.kind === "code").every(i=>Object.hasOwn(references, i.skillId))).toBe(true);
});
it.each([
  ["modules","from math import ceil\ndef solve(value): return list(map(ceil, value))"],
  ["files","def solve(value):\n    with open(file=value, encoding='utf-8') as f: return [s.strip() for s in f if s.strip()]"],
  ["csv-json","import json\ndef solve(value): return [r['name'] for r in json.loads(s=value)]"],
])("accepts equivalent executed %s calls",async(skill,source)=>{expect((await grade(skill,source)).passed).toBe(true);});
it("rejects an unrelated context manager even when a manually opened file is closed",async()=>{
  expect((await grade("files","from contextlib import nullcontext\ndef solve(value):\n    with nullcontext():\n        f=open(value,encoding='utf-8')\n        result=[s.strip() for s in f if s.strip()]\n        f.close()\n        return result")).passed).toBe(false);
});
it.each(["199 <= value['status'] < 300","200 <= value['status'] <= 300"])("rejects the wrong HTTP boundary %s",async(range)=>{
  expect((await grade("http",`def solve(value):\n    if ${range}: return value['payload']\n    if value['status']==404: return None\n    raise ValueError('status')`)).passed).toBe(false);
});
it("rejects rounding calls whose results are discarded",async()=>{
  expect((await grade("modules","import math\ndef solve(value):\n    unused=list(map(math.ceil,value))\n    return [int(n) if int(n)==n else int(n)+(n>0) for n in value]")).passed).toBe(false);
});
