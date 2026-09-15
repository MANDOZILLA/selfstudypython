// Offline pandas/numpy installer for the Pyodide grading runtime.
// The wheels are vendored in public/pyodide/wheels/ (see tests/pandas-offline.test.ts
// for the version-consistency and zero-network guarantees). This module unzips them
// into the runtime's site-packages without touching pyodide-lock.json or micropip.
export const PANDAS_WHEELS = [
  "numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
  "six-1.17.0-py2.py3-none-any.whl",
  "python_dateutil-2.9.0.post0-py2.py3-none-any.whl",
  "pytz-2026.1.post1-py2.py3-none-any.whl",
  "tzdata-2025.3-py2.py3-none-any.whl",
  "pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
  "micropip-0.11.1-py3-none-any.whl",
];

export async function defaultReadWheel(name) {
  // Node (tests): read from the repo checkout. Browser worker: same-origin fetch.
  if (typeof process !== "undefined" && process.versions?.node) {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    return new Uint8Array(readFileSync(resolve("public/pyodide/wheels", name)));
  }
  const response = await fetch(`/pyodide/wheels/${name}`);
  if (!response.ok) throw new Error(`Could not load the vendored data-science wheel ${name}: HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

const installed = new WeakMap();
export function ensurePandasInstalled(runtime, readWheel = defaultReadWheel, onProgress) {
  if (!installed.has(runtime)) {
    installed.set(runtime, (async () => {
      onProgress?.("packages");
      try {
        runtime.FS.mkdir("/wheels");
      } catch {
        // Already present from a previous install attempt on this runtime.
      }
      for (const wheel of PANDAS_WHEELS) {
        runtime.FS.writeFile(`/wheels/${wheel}`, await readWheel(wheel));
      }
      await runtime.runPythonAsync(`
import zipfile, sysconfig
_pandas_offline_purelib = sysconfig.get_paths()["purelib"]
for _pandas_offline_wheel in ${JSON.stringify(PANDAS_WHEELS)}:
    with zipfile.ZipFile(f"/wheels/{_pandas_offline_wheel}") as _pandas_offline_zip:
        _pandas_offline_zip.extractall(_pandas_offline_purelib)
del _pandas_offline_purelib, _pandas_offline_wheel, _pandas_offline_zip
`);
    })());
  }
  return installed.get(runtime);
}
