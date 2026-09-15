import { paymentsSuite } from "./catalog.js";
import { getGrader } from "./catalog.js";
import { ensurePandasInstalled } from "./pandas-offline.js";
import { apiSuite, contactsSuite, inventorySuite, csvTagsSuite, invoiceCentsSuite, webhookEventsSuite, settlementReconciliationSuite } from "./mission-suites.js";
import { diagnosticCallFormsSuite, diagnosticHttpSuite, diagnosticFilesSuite } from "./diagnostic-suites.js";
import { stackTraceSuite, logScanSuite, validatorsSuite, transformSuite, pandasCleanSuite, pandasProjectSuite, sqliteAggSuite, sqliteProjectSuite, moneyReconSuite, moneyProjectSuite, httpClientSuite, httpProjectSuite, llmGuardSuite, llmProjectSuite, recoveryProjectSuite, validationProjectSuite, transformProjectSuite } from "./mission-suites-2.js";
import { aggregateResult, failureResult, validRequest } from "./protocol.js";
export async function runSubmission(request, loadRuntime, onProgress) {
  if (!validRequest(request)) return failureResult(request, "This exercise has no available grader, or the request is invalid.");
  let stdout = "";
  let stderr = "";
  let namespace;
  try {
    const runtime = await loadRuntime();
    const grader = getGrader(request.exerciseId, request.graderId);
    if (grader?.packages?.includes("pandas")) {
      await ensurePandasInstalled(runtime, undefined, onProgress);
    }
    runtime.setStdout({ batched: text => { stdout = (stdout + text + "\n").slice(-20000); } });
    runtime.setStderr({ batched: text => { stderr = (stderr + text + "\n").slice(-20000); } });
    namespace = runtime.toPy({ submission_source: request.files["main.py"] });
    const suites = { "payments-csv-v1": paymentsSuite, "api-normalization-v1": apiSuite, "contacts-v1": contactsSuite, "inventory-v1": inventorySuite, "csv-tags-v1": csvTagsSuite, "invoice-cents-v1": invoiceCentsSuite, "webhook-events-v1": webhookEventsSuite, "settlement-reconciliation-v1": settlementReconciliationSuite, "diagnostic-call-forms-v1": diagnosticCallFormsSuite, "diagnostic-http-v1": diagnosticHttpSuite, "diagnostic-files-v1": diagnosticFilesSuite, "traceback-v1": stackTraceSuite, "logscan-v1": logScanSuite, "validators-v1": validatorsSuite, "transform-v1": transformSuite, "pandas-clean-v1": pandasCleanSuite, "pandas-project-v1": pandasProjectSuite, "sqlite-agg-v1": sqliteAggSuite, "sqlite-project-v1": sqliteProjectSuite, "money-recon-v1": moneyReconSuite, "money-project-v1": moneyProjectSuite, "http-client-v1": httpClientSuite, "http-project-v1": httpProjectSuite, "llm-guard-v1": llmGuardSuite, "llm-project-v1": llmProjectSuite, "recovery-project-v1": recoveryProjectSuite, "validation-project-v1": validationProjectSuite, "transform-project-v1": transformProjectSuite };
    const raw = JSON.parse(await runtime.runPythonAsync(suites[request.graderId], { globals: namespace }));
    return aggregateResult(request, raw, stdout, stderr);
  } catch (error) {
    return { ...failureResult(request, String(error)), stdout, stderr: stderr + String(error) };
  } finally {
    namespace?.destroy();
  }
}
