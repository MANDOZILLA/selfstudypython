import { loadPyodide } from "/pyodide/pyodide.mjs";
import { runSubmission } from "./grading/runner.js";
let runtime;
self.onmessage = async ({ data }) => {
  const result = await runSubmission(data, async () => {
    runtime ??= await loadPyodide({ indexURL: "/pyodide/" });
    return runtime;
  });
  self.postMessage(result);
};
