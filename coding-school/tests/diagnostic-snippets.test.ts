import { beforeAll, describe, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { resolve } from "node:path";
import { DIAGNOSTIC_ITEMS } from "../curriculum/diagnostic-items";
import { gradeDiagnosticConcept } from "../lib/diagnostic-grading";
import { ensurePandasInstalled } from "../public/grading/pandas-offline.js";

// Every code-reading placement item is executed for real: its recorded answer
// must be exactly what the snippet prints, and the grader must accept it.
const readingItems = DIAGNOSTIC_ITEMS.filter(item => item.concept?.expectedOutput);
const codeOf = (prompt: string) => /```python\n([\s\S]+)\n```$/.exec(prompt)?.[1] ?? "";

let runtime: Awaited<ReturnType<typeof loadPyodide>>;
beforeAll(async () => {
  runtime = await loadPyodide({ indexURL: resolve("public/pyodide") });
  if (readingItems.some(item => codeOf(item.prompt).includes("import pandas"))) await ensurePandasInstalled(runtime);
}, 180000);

async function run(code: string): Promise<string> {
  let stdout = "";
  runtime.setStdout({ batched: line => { stdout += `${line}\n`; } });
  const globals = runtime.toPy({});
  try { await runtime.runPythonAsync(code, { globals }); }
  finally { globals.destroy(); runtime.setStdout(); }
  return stdout.trimEnd();
}

describe("placement code-reading snippets", () => {
  it.each(readingItems.map(item => [item.id, item] as const))("%s prints its recorded answer", async (_id, item) => {
    const code = codeOf(item.prompt);
    expect(code, item.id).not.toBe("");
    const printed = await run(code);
    expect(printed, item.id).toBe(item.concept!.expectedOutput);
    expect(gradeDiagnosticConcept(item.id, printed).correct, item.id).toBe(true);
  }, 60000);
});
