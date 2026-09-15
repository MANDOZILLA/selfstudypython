"use client";

import { useEffect, useRef, useState } from "react";
import { advanceMissionStage, createDefaultState, getState, resetState, StateRecoveryError, saveMissionDraft, saveState, startOrResumeMission, replaceDiagnosticSession, type LearningState, type MissionDraft } from "../../lib/state";
import { getWorkbenchModel, persistAttempt, runStatus, type Destination, type RunStatus } from "../../lib/studio";
import { startGradingRun, type GradeResult } from "../../lib/runner";
import { answerConcept, classifyGradeResult, completeDiagnosticSession, createDiagnosticSession, recordCodingOutcome, saveDiagnosticDraft, type DiagnosticSession } from "../../lib/diagnostic";
import { gradeDiagnosticConcept } from "../../lib/diagnostic-grading";
import { DIAGNOSTIC_ITEMS } from "../../curriculum";
import { readRoute, routeHash, type Route } from "../../lib/route";

export function useStudio() {
  const [state, setState] = useState(createDefaultState);
  const stateRef = useRef(state);
  const [route, setRoute] = useState<Route>({ destination: "today" });
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [recoveryRaw, setRecoveryRaw] = useState<string | null>(null);
  const pendingWrite = useRef<LearningState | null>(null);
  const [learningMode, setLearningMode] = useState(true);
  const [localDrafts, setLocalDrafts] = useState<Record<string, MissionDraft>>({});
  const draftRef = useRef(localDrafts);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [status, setStatus] = useState<RunStatus>("Ready");
  const [attemptSaved, setAttemptSaved] = useState(false);
  const runRef = useRef<{ cancel: () => void; requestId: string } | null>(null);
  const [diagnosticResult, setDiagnosticResult] = useState<GradeResult | null>(null);
  const [diagnosticStatus, setDiagnosticStatus] = useState<RunStatus>("Ready");
  const [diagnosticStale, setDiagnosticStale] = useState(false);
  const diagnosticRunRef = useRef<{ cancel: () => void; requestId: string } | null>(null);
  const diagnosticBusy = diagnosticStatus === "Loading Python" || diagnosticStatus === "Running checks";

  function cancelRun() {
    runRef.current?.cancel();
    runRef.current = null;
  }
  function cancelDiagnosticRun() {
    diagnosticRunRef.current?.cancel();
    diagnosticRunRef.current = null;
  }
  useEffect(() => {
    const restore = () => {
      runRef.current?.cancel(); runRef.current = null;
      cancelDiagnosticRun(); setDiagnosticResult(null); setDiagnosticStatus("Ready"); setDiagnosticStale(false);
      setResult(null); setStatus("Ready"); setAttemptSaved(false);
      setRoute(readRoute(window.location.hash));
    };
    const frame = requestAnimationFrame(() => {
      try { const saved = getState(); stateRef.current = saved; setState(saved); }
      catch (error) { if (error instanceof StateRecoveryError) setRecoveryRaw(error.raw); else setStorageError(String(error)); }
      try { setLearningMode(window.localStorage.getItem("coding-school:learning-mode") !== "off"); }
      catch { setStorageError("Browser storage is unavailable. Keep this page open to preserve your draft."); }
      restore(); setReady(true);
    });
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("popstate", restore); window.removeEventListener("hashchange", restore); runRef.current?.cancel(); };
  }, []);

  const workbench = route.runId ? getWorkbenchModel(state, route.runId, route.taskId) : null;
  const draft = workbench?.task ? localDrafts[workbench.task.id] ?? workbench.draft : undefined;
  const busy = status === "Loading Python" || status === "Loading data-science packages…" || status === "Running checks";
  const assistanceUsed = Boolean(draft && (draft.assistance.hintsUsed || draft.assistance.aiAssisted || draft.assistance.solutionViewed));

  function commit(next: LearningState) {
    if (recoveryRaw !== null) return false;
    pendingWrite.current = next;
    try {
      const saved = saveState(next); stateRef.current = saved; setState(saved); pendingWrite.current = null; setStorageError(null); return true;
    } catch (error) {
      setStorageError(`${error instanceof Error ? error.message : String(error)} Your draft remains here. Retry saving before leaving.`); return false;
    }
  }
  /** Apply a state transition (e.g. recording an assessment attempt) and persist it. */
  function applyState(transition: (state: LearningState) => LearningState) {
    commit(transition(stateRef.current));
  }
  function flushDraft() {
    if (!workbench?.task) return true;
    const current = draftRef.current[workbench.task.id] ?? workbench.draft;
    if (!current) return true;
    try { return commit(saveMissionDraft(stateRef.current, workbench.run.id, workbench.task.id, current)); }
    catch (error) { setStorageError(String(error)); return false; }
  }
  function go(next: Route, replace = false) {
    cancelRun(); setResult(null); setStatus("Ready"); setAttemptSaved(false);
    cancelDiagnosticRun(); setDiagnosticResult(null); setDiagnosticStatus("Ready"); setDiagnosticStale(false);
    window.history[replace ? "replaceState" : "pushState"]({}, "", routeHash(next));
    setRoute(next);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => document.getElementById("page-title")?.focus());
  }
  function navigate(destination: Destination) {
    if (!flushDraft()) return;
    const next = { ...stateRef.current, dashboard: { activeTab: destination === "today" ? "overview" as const : destination } };
    if (commit(next)) go({ destination });
  }
  function start(missionId?: string) {
    if (!flushDraft()) return;
    try {
      const next = startOrResumeMission(stateRef.current, new Date(), missionId);
      const active = next.missionRuns.find(r => r.status === "active");
      if (active && commit(next)) {
        draftRef.current = {}; setLocalDrafts({});
        go({ destination: route.destination, runId: active.id });
      }
    } catch (error) { setStorageError(error instanceof Error ? error.message : String(error)); }
  }
  function updateDraft(partial: Partial<MissionDraft>) {
    if (!workbench?.task || !workbench.draft) return;
    if (learningMode && !assistanceUsed && partial.assistance) return;
    cancelRun(); setResult(null); setStatus("Ready"); setAttemptSaved(false);
    const current = draftRef.current[workbench.task.id] ?? workbench.draft;
    const next = { ...current, ...partial, updatedAt: new Date().toISOString() };
    draftRef.current = { ...draftRef.current, [workbench.task.id]: next };
    setLocalDrafts(draftRef.current);
    commit(saveMissionDraft(stateRef.current, workbench.run.id, workbench.task.id, next));
  }
  function continueStage() {
    if (!workbench || !flushDraft()) return;
    try {
      const current = getWorkbenchModel(stateRef.current, workbench.run.id)!;
      if (!current.stageComplete) { go({ ...route, taskId: current.task?.id }, true); return; }
      const next = advanceMissionStage(stateRef.current, workbench.run.id);
      if (!commit(next)) return;
      const run = next.missionRuns.find(r => r.id === workbench.run.id)!;
      if (run.status === "completed") go({ destination: "today", completedRunId: run.id });
      else go({ ...route, taskId: undefined }, true);
    } catch (error) { setStorageError(error instanceof Error ? error.message : String(error)); }
  }
  function submitText() {
    if (!workbench?.task || !draft || !flushDraft()) return;
    const task = workbench.task;
    const saved = persistAttempt(stateRef.current, workbench.run.id, task.id, { variantId: task.variants[0].id, ...draft }, saveState);
    if (!saved.saved) { setStorageError(saved.error); return; }
    stateRef.current = saved.state; setState(saved.state); setStorageError(null);
    // Acknowledging instruction opens its guided practice; reflection ends the mission.
    continueStage();
  }
  function runChecks() {
    if (runRef.current || !workbench?.task || !draft || !flushDraft()) return;
    const task = workbench.task, variant = task.variants[0], runId = workbench.run.id;
    const submitted = { ...draft, sourceFiles: { ...draft.sourceFiles } };
    const requestId = crypto.randomUUID();
    // Pin the current task while a passed attempt updates the next-task selector.
    const pinned = { ...route, taskId: task.id };
    window.history.replaceState({}, "", routeHash(pinned)); setRoute(pinned);
    setResult(null); setAttemptSaved(false); setStatus("Loading Python");
    runRef.current = { requestId, cancel: () => {} };
    const cancel = startGradingRun({ type: "run", requestId, exerciseId: variant.exerciseId, graderId: variant.graderId, files: submitted.sourceFiles }, data => {
      if (runRef.current?.requestId !== requestId) return;
      runRef.current = null;
      setResult(data); setStatus(runStatus(data));
      const saved = persistAttempt(stateRef.current, runId, task.id, { variantId: variant.id, ...submitted, result: data }, next => {
        pendingWrite.current = next;
        const written = saveState(next); pendingWrite.current = null; return written;
      });
      if (saved.saved) { stateRef.current = saved.state; setState(saved.state); setAttemptSaved(true); setStorageError(null); }
      else { setAttemptSaved(false); setStorageError(saved.error); }
    }, undefined, variant.timeoutMs ?? 15000, phase => {
      if (runRef.current?.requestId === requestId) setStatus(phase === "loading" ? "Loading Python" : phase === "packages" ? "Loading data-science packages…" : "Running checks");
    });
    if (runRef.current?.requestId === requestId) runRef.current.cancel = cancel;
  }
  function stopRun() { cancelRun(); setStatus("Ready"); setResult(null); }
  function diagnosticSession(): DiagnosticSession | undefined {
    return stateRef.current.diagnosticSessions.find(s => s.id === route.diagnosticSessionId);
  }
  function commitDiagnosticSession(session: DiagnosticSession) {
    return commit(replaceDiagnosticSession(stateRef.current, session));
  }
  function startDiagnostic() {
    const inProgress = [...stateRef.current.diagnosticSessions].reverse().find(s => s.status === "in-progress");
    const session = inProgress ?? createDiagnosticSession();
    if (!inProgress) commitDiagnosticSession(session);
    setDiagnosticResult(null); setDiagnosticStatus("Ready"); setDiagnosticStale(false);
    go({ destination: "today", diagnosticSessionId: session.id });
  }
  function retakeDiagnostic() {
    const session = createDiagnosticSession();
    if (!commitDiagnosticSession(session)) return;
    setDiagnosticResult(null); setDiagnosticStatus("Ready"); setDiagnosticStale(false);
    go({ destination: "today", diagnosticSessionId: session.id });
  }
  function openDiagnosticSession(sessionId: string) {
    setDiagnosticResult(null); setDiagnosticStatus("Ready"); setDiagnosticStale(false);
    go({ destination: "today", diagnosticSessionId: sessionId });
  }
  function updateDiagnosticDraft(patch: { answer?: string; code?: string; hints?: number }) {
    const session = diagnosticSession();
    if (!session || session.status !== "in-progress") return;
    commitDiagnosticSession(saveDiagnosticDraft(session, patch));
  }
  function revealDiagnosticHint() {
    const session = diagnosticSession();
    if (!session || session.status !== "in-progress") return;
    updateDiagnosticDraft({ hints: session.draftHints + 1 });
  }
  function answerDiagnosticConcept() {
    const session = diagnosticSession();
    if (!session || session.status !== "in-progress") return;
    const item = DIAGNOSTIC_ITEMS.find(i => i.id === session.currentItemId);
    if (!item || item.kind !== "concept") return;
    try {
      if (commitDiagnosticSession(answerConcept(session, item, session.draftAnswer, gradeDiagnosticConcept))) {
        setDiagnosticResult(null); setDiagnosticStale(false);
      }
    } catch (error) { setStorageError(error instanceof Error ? error.message : String(error)); }
  }
  function runDiagnosticCode() {
    const session = diagnosticSession();
    if (!session || session.status !== "in-progress" || diagnosticRunRef.current) return;
    const item = DIAGNOSTIC_ITEMS.find(i => i.id === session.currentItemId);
    if (!item || item.kind !== "coding" || !item.coding) return;
    const code = session.draftCode.trim() ? session.draftCode : item.coding.starterCode;
    const requestId = crypto.randomUUID();
    setDiagnosticResult(null); setDiagnosticStale(false); setDiagnosticStatus("Loading Python");
    diagnosticRunRef.current = { requestId, cancel: () => {} };
    const cancel = startGradingRun(
      { type: "run", requestId, exerciseId: item.coding.exerciseId, graderId: item.coding.graderId, files: { "main.py": code }, sessionId: session.id, taskId: item.id },
      data => {
        if (diagnosticRunRef.current?.requestId !== requestId) return;
        diagnosticRunRef.current = null;
        setDiagnosticResult(data); setDiagnosticStatus(runStatus(data));
        // Infrastructure failures record no evidence; the code is preserved and the item stays current.
        const outcome = classifyGradeResult(data) === "infra"
          ? { kind: "infra" as const, message: data.stderr || "The Python run could not complete." }
          : { kind: "graded" as const, passed: data.passed, executionOk: data.executionOk, graderVersion: data.graderVersion };
        const recorded = recordCodingOutcome(session, item, outcome, code);
        commitDiagnosticSession(recorded);
        // When the run advanced the session, its checks belong to the old item.
        if (recorded.currentItemId !== item.id) {
          setDiagnosticResult(null); setDiagnosticStatus("Ready"); setDiagnosticStale(false);
        }
      },
      undefined,
      15000,
      phase => { if (diagnosticRunRef.current?.requestId === requestId) setDiagnosticStatus(phase === "loading" ? "Loading Python" : "Running checks"); },
      () => {
        // Stale grader version: nothing was recorded. Stop the run so the
        // learner can run again instead of waiting for the timeout.
        if (diagnosticRunRef.current?.requestId !== requestId) return;
        cancelDiagnosticRun(); setDiagnosticStatus("Ready"); setDiagnosticStale(true);
      },
    );
    if (diagnosticRunRef.current?.requestId === requestId) diagnosticRunRef.current.cancel = cancel;
  }
  function stopDiagnosticRun() { cancelDiagnosticRun(); setDiagnosticStatus("Ready"); setDiagnosticResult(null); }
  function finishDiagnostic() {
    const session = diagnosticSession();
    if (!session || session.status !== "in-progress") return;
    try { commitDiagnosticSession(completeDiagnosticSession(session)); }
    catch (error) { setStorageError(error instanceof Error ? error.message : String(error)); }
  }
  function toggleLearningMode() {
    try { window.localStorage.setItem("coding-school:learning-mode", learningMode ? "off" : "on"); setLearningMode(!learningMode); }
    catch { setStorageError("Could not save Learning Mode. Your current setting remains active."); }
  }
  function retrySave() {
    const pending = pendingWrite.current;
    const saved = pending ? commit(pending) : workbench?.task ? flushDraft() : commit(stateRef.current);
    if (saved && result?.executionOk && pending?.attempts.length && pending.attempts.length > state.attempts.length) setAttemptSaved(true);
    return saved;
  }
  function exportRecovery() {
    if (recoveryRaw === null) return;
    const url = URL.createObjectURL(new Blob([recoveryRaw], { type: "text/plain" }));
    const link = document.createElement("a"); link.href = url; link.download = "coding-school-recovery.txt"; link.click(); URL.revokeObjectURL(url);
  }
  function retryRecovery() {
    try { const saved = getState(); stateRef.current = saved; setState(saved); setRecoveryRaw(null); setStorageError(null); }
    catch (error) { if (error instanceof StateRecoveryError) setRecoveryRaw(error.raw); setStorageError("The stored data is still unreadable. Export a copy, or reset with a backup."); }
  }
  async function downloadPortfolio(projectId: string) {
    const snapshots = stateRef.current.portfolio.filter(s => s.projectId === projectId);
    if (!snapshots.length) { setStorageError("No completed components for this project yet. Finish a tagged mission build to create your first snapshot."); return; }
    try {
      const { generatePortfolioZip, sanitizeDirName } = await import("../../lib/zip-export");
      const { getPortfolioProject } = await import("../../curriculum/portfolio-projects");
      const project = getPortfolioProject(projectId);
      const blob = await generatePortfolioZip(projectId, snapshots, "blob");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${sanitizeDirName(project?.title ?? projectId)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setStorageError(`Could not build the portfolio download: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  function resetRecovery() {
    if (recoveryRaw === null) return;
    try {
      window.localStorage.setItem(`coding-school:recovery:${Date.now()}`, recoveryRaw);
      const fresh = resetState(); stateRef.current = fresh; setState(fresh); setRecoveryRaw(null); setStorageError(null); go({ destination: "today" });
    } catch { setStorageError("Could not create a recovery backup. Export your data before freeing browser storage and retrying."); }
  }
  return { state, ready, route, workbench, draft, result, status, busy, attemptSaved, learningMode, assistanceUsed, storageError, recoveryRaw,
    navigate, start, updateDraft, continueStage, submitText, runChecks, stopRun, toggleLearningMode, retrySave, exportRecovery, retryRecovery, resetRecovery, downloadPortfolio, applyState,
    diagnosticResult, diagnosticStatus, diagnosticBusy, diagnosticStale,
    startDiagnostic, retakeDiagnostic, openDiagnosticSession, updateDiagnosticDraft, revealDiagnosticHint, answerDiagnosticConcept, runDiagnosticCode, stopDiagnosticRun, finishDiagnostic };
}
export type Studio = ReturnType<typeof useStudio>;
