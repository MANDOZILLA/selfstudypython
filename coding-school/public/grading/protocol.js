import { getGrader } from "./catalog.js";
// Project file names are constrained to safe relative paths so the worker can
// materialize them without path traversal, and so names are safe to embed in
// generated driver code and shell-adjacent contexts.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
export function isSafeFileName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 200) return false;
  return name.split("/").every(segment => segment !== "." && segment !== ".." && SAFE_SEGMENT.test(segment));
}
function isFilesMap(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value).every(([name, content]) => typeof content === "string" && isSafeFileName(name));
}
export function failureResult(request, message) {
  return { requestId: request?.requestId ?? "", exerciseId: request?.exerciseId ?? "", graderId: request?.graderId ?? "",
    sessionId: request?.sessionId ?? null, taskId: request?.taskId ?? null,
    executionOk: false, passed: false, score: 0, stdout: "", stderr: message,
    graderVersion: getGrader(request?.exerciseId, request?.graderId)?.version ?? "unavailable",
    tests: [{ id: "execution", name: "Execution and grader available", required: true, passed: false, detail: message }] };
}
export function validRequest(request) {
  if (request?.type !== "run" || typeof request.requestId !== "string" || request.requestId.length === 0) return false;
  if (typeof request.exerciseId !== "string" || request.exerciseId.length === 0) return false;
  if (!isFilesMap(request.files)) return false;
  const names = Object.keys(request.files);
  if (names.length === 0) return false;
  // Multi-file IDE projects declare their entrypoint; single-file requests
  // keep working because the default entrypoint is "main.py".
  const entrypoint = request.entrypoint ?? "main.py";
  if (typeof entrypoint !== "string" || !entrypoint.endsWith(".py") || !names.includes(entrypoint)) return false;
  if (request.fixtures !== undefined) {
    if (!isFilesMap(request.fixtures)) return false;
    // Fixtures are readable project data, never submitted source: they must
    // not shadow a learner file.
    if (Object.keys(request.fixtures).some(name => names.includes(name))) return false;
  }
  const mode = request.mode ?? "grade";
  if (mode !== "grade" && mode !== "execute") return false;
  // Execute mode runs the entrypoint without grading, so it needs no
  // registered grader; grade mode does.
  if (mode === "grade" && !getGrader(request.exerciseId, request.graderId)) return false;
  return true;
}
export function aggregateResult(request, raw, stdout = "", stderr = "") {
  const grader = getGrader(request?.exerciseId, request?.graderId);
  if (!grader || !raw || typeof raw.executionOk !== "boolean" || !Array.isArray(raw.tests)) return failureResult(request, "Invalid or unavailable grader result.");
  const tests = raw.tests;
  const wellFormed = tests.length === grader.requiredTests.length &&
    tests.every(test => test && typeof test.id === "string" && typeof test.name === "string" && typeof test.passed === "boolean" && test.required === true && typeof test.detail === "string") &&
    new Set(tests.map(test => test.id)).size === tests.length && grader.requiredTests.every(id => tests.some(test => test.id === id));
  if (!wellFormed) return { ...failureResult(request, raw.error || "Incomplete or malformed required checks."), stdout, stderr: stderr || raw.error || "Incomplete or malformed required checks." };
  const score = raw.executionOk ? tests.filter(test => test.passed).length / tests.length : 0;
  // Structured execution status and per-skill rubric evidence travel with
  // every graded result so the IDE can show them without recomputing.
  const execution = raw.executionOk
    ? { status: "ok" }
    : { status: "error", message: raw.error || "Checks did not pass." };
  const skillChecks = request?.skillChecks;
  const skills = skillChecks !== null && typeof skillChecks === "object" && !Array.isArray(skillChecks)
    ? Object.entries(skillChecks).map(([skillId, checkIds]) => {
        const ids = Array.isArray(checkIds) ? checkIds.filter(id => typeof id === "string") : [];
        return { skillId, checkIds: ids,
          passed: raw.executionOk && ids.length > 0 && ids.every(id => tests.some(test => test.id === id && test.passed)) };
      })
    : [];
  return { requestId: request.requestId, exerciseId: request.exerciseId, graderId: request.graderId,
    sessionId: request.sessionId ?? null, taskId: request.taskId ?? null,
    executionOk: raw.executionOk, passed: raw.executionOk && tests.length > 0 && tests.every(test => test.passed),
    score, stdout, stderr: [stderr, raw.error].filter(Boolean).join("\n"), graderVersion: grader.version, tests, execution, skills };
}
export function formatExecutionError(execution) {
  if (!execution || execution.status !== "error") return "";
  const where = execution.file ? `File "${execution.file}"${execution.line ? `, line ${execution.line}` : ""}` : "The program";
  return `${where}: ${execution.message || "an error occurred"}`;
}
// Execute mode runs the entrypoint without grading: no named tests, no
// grader version, just the structured execution status and console output.
export function executedResult(request, execution, stdout = "", stderr = "") {
  const status = execution && typeof execution === "object" ? execution.status : "unknown";
  return { requestId: request?.requestId ?? "", exerciseId: request?.exerciseId ?? "", graderId: request?.graderId ?? "",
    sessionId: request?.sessionId ?? null, taskId: request?.taskId ?? null,
    mode: "executed", executionOk: status === "ok", passed: false, score: 0,
    stdout, stderr: [stderr, formatExecutionError(execution)].filter(Boolean).join("\n"),
    graderVersion: "n/a", tests: [], skills: [], execution: execution ?? { status: "unknown" } };
}
export function verifyWorkerResult(request, value) {
  if (!value || value.requestId !== request.requestId || value.exerciseId !== request.exerciseId) return null;
  if ((request.mode ?? "grade") === "execute") {
    // Execute mode has no grader: verify the request binding and the
    // execution envelope shape, then accept it as-is.
    if (request.graderId && value.graderId !== request.graderId) return null;
    if (request.sessionId != null && value.sessionId !== request.sessionId) return null;
    if (request.taskId != null && value.taskId !== request.taskId) return null;
    if (value.mode !== "executed" || typeof value.stdout !== "string" || typeof value.stderr !== "string" ||
      !value.execution || typeof value.execution.status !== "string") {
      return failureResult(request, "Malformed worker response.");
    }
    return value;
  }
  if (value.graderId !== request.graderId) return null;
  if (request.sessionId != null && value.sessionId !== request.sessionId) return null;
  if (request.taskId != null && value.taskId !== request.taskId) return null;
  const grader = getGrader(request.exerciseId, request.graderId);
  if (typeof value.stdout !== "string" || typeof value.stderr !== "string") return failureResult(request, "Malformed worker response.");
  // A stale or mismatched grader version is ignored, never relabeled to the
  // current version and never converted into a failed learner attempt.
  if (value.graderVersion !== grader?.version) {
    return { ignored: true, reason: "grader-version-mismatch", requestId: request.requestId, exerciseId: request.exerciseId, graderId: request.graderId };
  }
  const verified = aggregateResult(request, value, value.stdout, value.stderr);
  if (value.passed !== verified.passed || value.score !== verified.score) return failureResult(request, "Worker result did not match its required checks.");
  return verified;
}
