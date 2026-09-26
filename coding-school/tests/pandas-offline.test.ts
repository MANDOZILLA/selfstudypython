import { describe, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const WHEEL_DIR = resolve("public/pyodide/wheels");
const EXPECTED_WHEELS = [
  "numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
  "six-1.17.0-py2.py3-none-any.whl",
  "python_dateutil-2.9.0.post0-py2.py3-none-any.whl",
  "pytz-2026.1.post1-py2.py3-none-any.whl",
  "tzdata-2025.3-py2.py3-none-any.whl",
  "pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
  "micropip-0.11.1-py3-none-any.whl",
];

describe("pandas offline bundle", () => {
  it("vendors every wheel the offline installer needs", () => {
    for (const wheel of EXPECTED_WHEELS) {
      expect(existsSync(join(WHEEL_DIR, wheel)), `missing vendored wheel: ${wheel}`).toBe(true);
    }
  });

  it("keeps vendored wheels consistent with pyodide-lock.json", () => {
    const lock = JSON.parse(readFileSync(resolve("public/pyodide/pyodide-lock.json"), "utf8"));
    const byFileName = new Map<string, string>();
    for (const [name, entry] of Object.entries<{ file_name?: string; version?: string }>(lock.packages)) {
      if (entry.file_name) byFileName.set(entry.file_name, `${name}@${entry.version}`);
    }
    const vendored = readdirSync(WHEEL_DIR).filter(f => f.endsWith(".whl"));
    expect(vendored.length).toBeGreaterThan(0);
    for (const wheel of vendored) {
      expect(byFileName.has(wheel), `${wheel} is not pinned in pyodide-lock.json; re-vendor on Pyodide upgrade`).toBe(true);
    }
    for (const wheel of EXPECTED_WHEELS) {
      expect(vendored).toContain(wheel);
    }
  });

  it("installs and runs a pandas data-quality workload with zero network access", async () => {
    const pyodide = await loadPyodide({ indexURL: resolve("public/pyodide") });
    // Hard network block: any http(s) fetch after this point fails the test.
    const realFetch = globalThis.fetch;
    let blocked = 0;
    globalThis.fetch = (async (url: unknown, ...rest: unknown[]) => {
      if (/^https?:\/\//i.test(String(url))) { blocked++; throw new Error(`network blocked in offline test: ${url}`); }
      return (realFetch as typeof fetch)(url as never, ...(rest as []));
    }) as typeof fetch;
    try {
      pyodide.FS.mkdir("/wheels");
      for (const wheel of EXPECTED_WHEELS) {
        pyodide.FS.writeFile(`/wheels/${wheel}`, new Uint8Array(readFileSync(join(WHEEL_DIR, wheel))));
      }
      await pyodide.runPythonAsync(`
import zipfile, sysconfig
sp = sysconfig.get_paths()["purelib"]
for w in ${JSON.stringify(EXPECTED_WHEELS)}:
    with zipfile.ZipFile(f"/wheels/{w}") as z:
        z.extractall(sp)
`);
      const result = await pyodide.runPythonAsync(`
import io, pandas as pd
df = pd.read_csv(io.StringIO("order_id,region,amount\\n1,north,10.5\\n2,south,\\n3,north,7.25\\n"))
df["amount"] = df["amount"].fillna(df["amount"].mean())
agg = df.groupby("region", as_index=False).agg(total=("amount", "sum"))
north = agg.loc[agg["region"] == "north", "total"].iloc[0]
f"pandas={pd.__version__} rows={len(df)} north_total={north:.2f}"
`);
      expect(result).toContain("pandas=3.0.2");
      expect(result).toContain("rows=3");
      expect(result).toContain("north_total=17.75");
      expect(blocked).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 120000);
});
