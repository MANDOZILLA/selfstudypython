"use client";

import { useEffect, useRef, useState } from "react";
import { advanceMissionStage, createDefaultState, getState, resetState, StateRecoveryError, saveMissionDraft, saveState, startOrResumeMission, type LearningState, type MissionDraft } from "../../lib/state";
import { destinations, getWorkbenchModel, persistAttempt, runStatus, type Destination, type RunStatus } from "../../lib/studio";
import { startGradingRun, type GradeResult } from "../../lib/runner";

type Route = { destination: Destination; runId?: string; taskId?: string; completedRunId?: string };
function readRoute(): Route {
  const [name, search] = window.location.hash.slice(1).split("?");
  const params = new URLSearchParams(search);
  if (name === "summary" && params.get("run")) return { destination: "today", completedRunId: params.get("run")! };
  if (name === "workbench" && params.get("run")) return { destination: "today", runId: params.get("run")!, taskId: params.get("task") ?? undefined };
  return { destination: destinations.some(d => d.id === name) ? name as Destination : "today" };
}
function routeHash(route: Route) {
  if (route.completedRunId) return `#summary?run=${encodeURIComponent(route.completedRunId)}`;
  if (!route.runId) return `#${route.destination}`;
  const params = new URLSearchParams({ run: route.runId });
  if (route.taskId) params.set("task", route.taskId);
  return `#workbench?${params}`;
}

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

  function cancelRun() {
    runRef.current?.cancel();
    runRef.current = null;
  }
  useEffect(() => {
    const restore = () => {
      runRef.current?.cancel(); runRef.current = null;
      setResult(null); setStatus("Ready"); setAttemptSaved(false);
      setRoute(readRoute());
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
  const busy = status === "Loading Python" || status === "Running checks";
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
  function flushDraft() {
    if (!workbench?.task) return true;
    const current = draftRef.current[workbench.task.id] ?? workbench.draft;
    if (!current) return true;
    try { return commit(saveMissionDraft(stateRef.current, workbench.run.id, workbench.task.id, current)); }
    catch (error) { setStorageError(String(error)); return false; }
  }
  function go(next: Route, replace = false) {
    cancelRun(); setResult(null); setStatus("Ready"); setAttemptSaved(false);
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
    }, undefined, 15000, phase => {
      if (runRef.current?.requestId === requestId) setStatus(phase === "loading" ? "Loading Python" : "Running checks");
    });
    if (runRef.current?.requestId === requestId) runRef.current.cancel = cancel;
  }
  function stopRun() { cancelRun(); setStatus("Ready"); setResult(null); }
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
  function resetRecovery() {
    if (recoveryRaw === null) return;
    try {
      window.localStorage.setItem(`coding-school:recovery:${Date.now()}`, recoveryRaw);
      const fresh = resetState(); stateRef.current = fresh; setState(fresh); setRecoveryRaw(null); setStorageError(null); go({ destination: "today" });
    } catch { setStorageError("Could not create a recovery backup. Export your data before freeing browser storage and retrying."); }
  }
  return { state, ready, route, workbench, draft, result, status, busy, attemptSaved, learningMode, assistanceUsed, storageError, recoveryRaw,
    navigate, start, updateDraft, continueStage, submitText, runChecks, stopRun, toggleLearningMode, retrySave, exportRecovery, retryRecovery, resetRecovery };
}
export type Studio = ReturnType<typeof useStudio>;
