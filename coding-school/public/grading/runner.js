import { paymentsSuite } from "./catalog.js";
import { getGrader } from "./catalog.js";
import { ensurePandasInstalled } from "./pandas-offline.js";
import { apiSuite, contactsSuite, inventorySuite, csvTagsSuite, invoiceCentsSuite, webhookEventsSuite, settlementReconciliationSuite } from "./mission-suites.js";
import { diagnosticCallFormsSuite, diagnosticHttpSuite, diagnosticFilesSuite } from "./diagnostic-suites.js";
import { stackTraceSuite, logScanSuite, validatorsSuite, transformSuite, pandasCleanSuite, pandasProjectSuite, sqliteAggSuite, sqliteProjectSuite, moneyReconSuite, moneyProjectSuite, httpClientSuite, httpProjectSuite, llmGuardSuite, llmProjectSuite, recoveryProjectSuite, validationProjectSuite, transformProjectSuite } from "./mission-suites-2.js";
import { foundationsDebugSuite, foundationsScratchSuite, foundationsProjectSuite, dataDebugSuite, dataScratchSuite, dataProjectSuite, appliedDebugSuite, appliedScratchSuite, appliedProjectSuite } from "./assessment-suites.js";
import { aggregateResult, failureResult, validRequest } from "./protocol.js";
import { aggregateResult, executedResult, failureResult, validRequest } from "./protocol.js";
// Executes the entrypoint inside the worker and reports a structured
// execution status with the real file and line of any failure. Tracebacks
// name the actual project file because the source is compiled with its name.
const IDE_DRIVER = String.raw`
import json as __ide_json
import sys as __ide_sys
import traceback as __ide_traceback
__ide_base = __ide_workdir + "/"
def __ide_relname(path, fallback):
    path = path or fallback
    return path[len(__ide_base):] if path.startswith(__ide_base) else path
try:
    with open(__ide_workdir + "/" + __ide_entrypoint, "r", encoding="utf-8") as __ide_file:
        __ide_source = __ide_file.read()
    __ide_code = compile(__ide_source, __ide_entrypoint, "exec")
    exec(__ide_code, {"__name__": "__main__", "__file__": __ide_workdir + "/" + __ide_entrypoint})
    __ide_execution = __ide_json.dumps({"status": "ok"})
except SyntaxError as __ide_error:
    __ide_execution = __ide_json.dumps({"status": "error", "kind": "syntax",
        "file": __ide_relname(__ide_error.filename, __ide_entrypoint), "line": __ide_error.lineno or 0,
        "message": str(__ide_error)})
except BaseException:
    __ide_tb = __ide_traceback.extract_tb(__ide_sys.exc_info()[2])
    __ide_frame = __ide_tb[-1] if __ide_tb else None
    __ide_execution = __ide_json.dumps({"status": "error", "kind": "runtime",
        "file": __ide_relname(__ide_frame.filename if __ide_frame else None, __ide_entrypoint),
        "line": __ide_frame.lineno if __ide_frame else 0,
        "message": str(__ide_sys.exc_info()[1])})
__ide_execution
`;
function sanitizeDirName(value) {
  return String(value ?? "run").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "run";
}
function writeProjectFiles(runtime, request, workdir) {
  runtime.FS.mkdirTree(workdir);
  for (const [name, content] of Object.entries(request.fixtures ?? {})) {
    const path = `${workdir}/${name}`;
    runtime.FS.mkdirTree(path.split("/").slice(0, -1).join("/"));
    runtime.FS.writeFile(path, content);
  }
  for (const [name, content] of Object.entries(request.files)) {
    const path = `${workdir}/${name}`;
    runtime.FS.mkdirTree(path.split("/").slice(0, -1).join("/"));
    runtime.FS.writeFile(path, content);
  }
}
async function runIdeExecution(runtime, entrypoint, workdir) {
  const namespace = runtime.toPy({ __ide_entrypoint: entrypoint, __ide_workdir: workdir });
  try {
    return JSON.parse(await runtime.runPythonAsync(IDE_DRIVER, { globals: namespace }));
  } finally {
    namespace.destroy();
  }
}
export async function runSubmission(request, loadRuntime, onProgress) {
  if (!validRequest(request)) return failureResult(request, "This exercise has no available grader, or the request is invalid.");
  let stdout = "";
  let stderr = "";
  let namespace;
  const mode = request.mode ?? "grade";
  const entrypoint = request.entrypoint ?? "main.py";
  try {
    const runtime = await loadRuntime();
    const grader = getGrader(request.exerciseId, request.graderId);
    if (grader?.packages?.includes("pandas")) {
      await ensurePandasInstalled(runtime, undefined, onProgress);
    }
    runtime.setStdout({ batched: text => { stdout = (stdout + text + "\n").slice(-20000); } });
    runtime.setStderr({ batched: text => { stderr = (stderr + text + "\n").slice(-20000); } });
    // Each run gets an isolated working directory named after its request, so
    // files from one run can never leak into another sharing the runtime.
    // The project directory is first on sys.path so project files import
    // each other, and it is the working directory so fixtures open by
    // relative path. Modules imported from any project directory are evicted
    // from sys.modules so a re-run always executes the current file contents.
    const workdir = `/workspace/${sanitizeDirName(request.requestId)}`;
    writeProjectFiles(runtime, request, workdir);
    await runtime.runPythonAsync(`import os, sys\nif ${JSON.stringify(workdir)} not in sys.path:\n    sys.path.insert(0, ${JSON.stringify(workdir)})\nos.chdir(${JSON.stringify(workdir)})\n__ide_prefix = "/workspace/"\nfor __ide_cached in [name for name, module in sys.modules.items() if getattr(module, "__file__", "") and str(module.__file__).startswith(__ide_prefix)]:\n    del sys.modules[__ide_cached]`);
    if (mode === "execute") {
      const execution = await runIdeExecution(runtime, entrypoint, workdir);
      return executedResult(request, execution, stdout, stderr);
    }
    namespace = runtime.toPy({ submission_source: request.files[entrypoint] });
    const suites = { "payments-csv-v1": paymentsSuite, "api-normalization-v1": apiSuite, "contacts-v1": contactsSuite, "inventory-v1": inventorySuite, "csv-tags-v1": csvTagsSuite, "invoice-cents-v1": invoiceCentsSuite, "webhook-events-v1": webhookEventsSuite, "settlement-reconciliation-v1": settlementReconciliationSuite, "diagnostic-call-forms-v1": diagnosticCallFormsSuite, "diagnostic-http-v1": diagnosticHttpSuite, "diagnostic-files-v1": diagnosticFilesSuite, "traceback-v1": stackTraceSuite, "logscan-v1": logScanSuite, "validators-v1": validatorsSuite, "transform-v1": transformSuite, "pandas-clean-v1": pandasCleanSuite, "pandas-project-v1": pandasProjectSuite, "sqlite-agg-v1": sqliteAggSuite, "sqlite-project-v1": sqliteProjectSuite, "money-recon-v1": moneyReconSuite, "money-project-v1": moneyProjectSuite, "http-client-v1": httpClientSuite, "http-project-v1": httpProjectSuite, "llm-guard-v1": llmGuardSuite, "llm-project-v1": llmProjectSuite, "recovery-project-v1": recoveryProjectSuite, "validation-project-v1": validationProjectSuite, "transform-project-v1": transformProjectSuite, "foundations-debug-v1": foundationsDebugSuite, "foundations-scratch-v1": foundationsScratchSuite, "foundations-project-v1": foundationsProjectSuite, "data-debug-v1": dataDebugSuite, "data-scratch-v1": dataScratchSuite, "data-project-v1": dataProjectSuite, "applied-debug-v1": appliedDebugSuite, "applied-scratch-v1": appliedScratchSuite, "applied-project-v1": appliedProjectSuite };
    const raw = JSON.parse(await runtime.runPythonAsync(suites[request.graderId], { globals: namespace }));
    return aggregateResult(request, raw, stdout, stderr);
  } catch (error) {
    if (mode === "execute") {
      return executedResult(request, { status: "error", kind: "driver", file: entrypoint, line: 0, message: String(error?.message ?? error) }, stdout, stderr);
    }
    return { ...failureResult(request, String(error)), stdout, stderr: stderr + String(error) };
  } finally {
    namespace?.destroy();
  }
}
