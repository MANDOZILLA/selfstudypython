"use client";

import { useEffect, useRef, useState } from "react";
import { advanceMissionStage, createDefaultState, resetState, StateRecoveryError, saveMissionDraft, recordMissionAttempt, startOrResumeMission, type LearningState, type MissionDraft } from "../../lib/state";
import { destinations, getWorkbenchModel, runStatus, type Destination, type RunStatus } from "../../lib/studio";
import { startGradingRun, type GradeResult } from "../../lib/runner";
import { LearnerStore } from "../../lib/learner-store";
import type { Snapshot } from "../../lib/persistence-contract";
import { currentDiagnostic, diagnosticDraft, getDiagnosticItem, recordDiagnosticAttempt, saveDiagnosticDraft, startDiagnostic, submitDiagnostic } from "../../lib/diagnostic";
import type { DiagnosticDraft } from "../../lib/diagnostic-types";

type Route = { destination: Destination; runId?: string; taskId?: string; completedRunId?: string; diagnostic?: boolean };
function readRoute(): Route {
  const [name, search] = window.location.hash.slice(1).split("?");
  const params = new URLSearchParams(search);
  if (name === "baseline") return {destination:"assessment",diagnostic:true};
  if (name === "summary" && params.get("run")) return { destination: "today", completedRunId: params.get("run")! };
  if (name === "workbench" && params.get("run")) return { destination: "today", runId: params.get("run")!, taskId: params.get("task") ?? undefined };
  return { destination: destinations.some(d => d.id === name) ? name as Destination : "today" };
}
function routeHash(route: Route) {
  if (route.diagnostic) return "#baseline";
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
  const storeRef = useRef<LearnerStore | null>(null);
  const [importPending, setImportPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const savingCount = useRef(0);
  const actionLock = useRef(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [learningMode, setLearningMode] = useState(true);
  const [localDrafts, setLocalDrafts] = useState<Record<string, MissionDraft>>({});
  const draftRef = useRef(localDrafts);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [status, setStatus] = useState<RunStatus>("Ready");
  const [attemptSaved, setAttemptSaved] = useState(false);
  const runRef = useRef<{ cancel: () => void; requestId: string } | null>(null);
  const editRevision = useRef(0);
  const [baselineDrafts,setBaselineDrafts]=useState<Record<string,DiagnosticDraft>>({});
  const baselineDraftRef=useRef(baselineDrafts);

  function cancelRun() {
    editRevision.current++;
    runRef.current?.cancel();
    runRef.current = null;
  }
  function accept(snapshot: Snapshot) {
    stateRef.current = snapshot.state; setState(snapshot.state); setLearningMode(snapshot.learningMode); setStorageError(null);
  }
  async function hydrate() {
    try {
      const store = storeRef.current ??= new LearnerStore();
      const { snapshot, legacy } = await store.hydrate();
      accept(snapshot); setImportPending(Boolean(legacy)); setRecoveryRaw(null); setReady(true);
    } catch (error) {
      if (error instanceof StateRecoveryError) { setRecoveryRaw(error.raw); setReady(true); }
      else { setReady(false); setStorageError(error instanceof Error ? error.message : "Your saved work could not be loaded."); }
    }
  }
  useEffect(() => {
    const restore = () => {
      runRef.current?.cancel(); runRef.current = null;
      setResult(null); setStatus("Ready"); setAttemptSaved(false);
      setRoute(readRoute());
    };
    const frame = requestAnimationFrame(() => { restore(); void hydrate(); });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (draftTimer.current || storeRef.current?.pending || savingCount.current) event.preventDefault();
    };
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    window.addEventListener("beforeunload", beforeUnload);
    return () => { cancelAnimationFrame(frame); if (draftTimer.current) clearTimeout(draftTimer.current); window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("popstate", restore); window.removeEventListener("hashchange", restore); runRef.current?.cancel(); };
    // Hydration runs once; all asynchronous persistence uses store/state refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const workbench = route.runId ? getWorkbenchModel(state, route.runId, route.taskId) : null;
  const baseline=route.diagnostic?currentDiagnostic(state):undefined;
  const baselineItem=baseline?.currentItemId?getDiagnosticItem(baseline.currentItemId):undefined;
  const baselineKey=baseline && baselineItem?`${baseline.id}/${baselineItem.id}`:"";
  const baselineDraft=baseline && baselineItem?baselineDrafts[baselineKey]??diagnosticDraft(baseline,baselineItem):undefined;
  const draft = workbench?.task ? localDrafts[workbench.task.id] ?? workbench.draft : undefined;
  const busy = status === "Loading Python" || status === "Running checks";
  const assistanceUsed = Boolean(draft && (draft.assistance.hintsUsed || draft.assistance.aiAssisted || draft.assistance.solutionViewed));

  async function commit(update: (state: LearningState) => LearningState, mode?: boolean) {
    if (!ready || recoveryRaw !== null || importPending || !storeRef.current) return false;
    savingCount.current++; setSaving(true);
    try {
      accept(await storeRef.current.save(update, mode)); return true;
    } catch (error) {
      setStorageError(`${error instanceof Error ? error.message : String(error)} Your draft remains here. Retry saving before leaving.`); return false;
    } finally { savingCount.current--; setSaving(savingCount.current > 0); }
  }
  async function flushDraft() {
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    if(baseline && baselineItem){
      const current=baselineDraftRef.current[baselineKey]??diagnosticDraft(baseline,baselineItem);
      const saved=await commit(state=>saveDiagnosticDraft(state,baseline.id,baselineItem.id,current));
      if(saved && (!baselineDraftRef.current[baselineKey] || baselineDraftRef.current[baselineKey]===current)) setDirty(false);
      return saved;
    }
    if (!workbench?.task) return true;
    const current = draftRef.current[workbench.task.id] ?? workbench.draft;
    if (!current) return true;
    try {
      const taskId = workbench.task.id;
      const saved = await commit(state => saveMissionDraft(state, workbench.run.id, taskId, current));
      if (saved && (!draftRef.current[taskId] || draftRef.current[taskId] === current)) setDirty(false);
      return saved;
    }
    catch (error) { setStorageError(String(error)); return false; }
  }
  function go(next: Route, replace = false) {
    cancelRun(); setResult(null); setStatus("Ready"); setAttemptSaved(false);
    window.history[replace ? "replaceState" : "pushState"]({}, "", routeHash(next));
    setRoute(next);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => document.getElementById("page-title")?.focus());
  }
  async function navigate(destination: Destination) {
    if (actionLock.current) return;
    actionLock.current = true;
    try {
      if (!await flushDraft()) return;
      if (await commit(state => ({ ...state, dashboard: { activeTab: destination === "today" ? "overview" as const : destination } }))) go({ destination });
    } finally { actionLock.current = false; }
  }
  async function start(missionId?: string) {
    if (actionLock.current) return;
    actionLock.current = true;
    try {
      if (!await flushDraft() || !await commit(state => startOrResumeMission(state, new Date(), missionId))) return;
      const active = stateRef.current.missionRuns.find(r => r.status === "active");
      if (active) {
        draftRef.current = {}; setLocalDrafts({});
        go({ destination: route.destination, runId: active.id });
      }
    } catch (error) { setStorageError(error instanceof Error ? error.message : String(error)); }
    finally { actionLock.current = false; }
  }
  async function beginBaseline(retake=false) {
    if(actionLock.current)return;actionLock.current=true;
    try { if(await flushDraft() && await commit(state=>startDiagnostic(state,new Date(),retake))) go({destination:"assessment",diagnostic:true}); }
    finally{actionLock.current=false;}
  }
  function updateBaselineDraft(partial:Partial<DiagnosticDraft>) {
    if(!baseline || !baselineItem || !baselineDraft)return;
    cancelRun();setResult(null);setStatus("Ready");setAttemptSaved(false);
    const next={...(baselineDraftRef.current[baselineKey]??baselineDraft),...partial};
    baselineDraftRef.current={...baselineDraftRef.current,[baselineKey]:next};setBaselineDrafts(baselineDraftRef.current);setDirty(true);
    if(draftTimer.current)clearTimeout(draftTimer.current);
    draftTimer.current=setTimeout(async()=>{draftTimer.current=null;const saved=await commit(state=>saveDiagnosticDraft(state,baseline.id,baselineItem.id,next));if(saved&&baselineDraftRef.current[baselineKey]===next)setDirty(false);},250);
  }
  async function runBaselineChecks(){
    if(actionLock.current||runRef.current||!baseline||!baselineItem||!baselineDraft||baselineItem.kind!=="code")return;
    actionLock.current=true;const submittedRevision=editRevision.current;
    const flushed=await flushDraft();actionLock.current=false;
    if(!flushed||submittedRevision!==editRevision.current)return;
    const sourceFiles={...baselineDraft.sourceFiles};const requestId=crypto.randomUUID();
    setResult(null);setStatus("Loading Python");setAttemptSaved(false);
    runRef.current={requestId,cancel:()=>{}};
    const cancel=startGradingRun({type:"run",requestId,exerciseId:baselineItem.id,graderId:baselineItem.graderId!,files:sourceFiles},async data=>{
      if(runRef.current?.requestId!==requestId || submittedRevision!==editRevision.current)return;
      runRef.current=null;setResult(data);setStatus(runStatus(data));
      if(data.tests.some((check:{id:string})=>check.id==="execution")) return;
      const saved=await commit(state=>recordDiagnosticAttempt(state,baseline.id,baselineItem.id,requestId,sourceFiles,data));
      if(submittedRevision===editRevision.current)setAttemptSaved(saved);
    },undefined,15000,phase=>{if(runRef.current?.requestId===requestId)setStatus(phase==="loading"?"Loading Python":"Running checks");});
    if(runRef.current?.requestId===requestId)runRef.current.cancel=cancel;
  }
  async function answerBaseline(skip=false){
    if(actionLock.current||!baseline||!baselineItem)return;actionLock.current=true;
    try {if(await flushDraft() && await commit(state=>submitDiagnostic(state,baseline.id,baselineItem.id,{requestId:crypto.randomUUID(),skip})))go({destination:"assessment",diagnostic:true},true);}
    finally{actionLock.current=false;}
  }
  function updateDraft(partial: Partial<MissionDraft>) {
    if (!workbench?.task || !workbench.draft) return;
    if (learningMode && !assistanceUsed && partial.assistance) return;
    cancelRun(); setResult(null); setStatus("Ready"); setAttemptSaved(false);
    const current = draftRef.current[workbench.task.id] ?? workbench.draft;
    const next = { ...current, ...partial, updatedAt: new Date().toISOString() };
    draftRef.current = { ...draftRef.current, [workbench.task.id]: next };
    setLocalDrafts(draftRef.current); setDirty(true);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const taskId = workbench.task.id, runId = workbench.run.id;
    draftTimer.current = setTimeout(async () => {
      draftTimer.current = null;
      const saved = await commit(state => saveMissionDraft(state, runId, taskId, next));
      if (saved && draftRef.current[taskId] === next) setDirty(false);
    }, 350);
  }
  async function advance() {
    if (!workbench || !await flushDraft()) return;
    try {
      const current = getWorkbenchModel(stateRef.current, workbench.run.id)!;
      if (!current.stageComplete) { go({ ...route, taskId: current.task?.id }, true); return; }
      if (!await commit(state => advanceMissionStage(state, workbench.run.id))) return;
      const run = stateRef.current.missionRuns.find(r => r.id === workbench.run.id)!;
      if (run.status === "completed") go({ destination: "today", completedRunId: run.id });
      else go({ ...route, taskId: undefined }, true);
    } catch (error) { setStorageError(error instanceof Error ? error.message : String(error)); }
  }
  async function continueStage() {
    if (actionLock.current) return;
    actionLock.current = true;
    try { await advance(); } finally { actionLock.current = false; }
  }
  async function submitText() {
    if (actionLock.current || !workbench?.task || !draft) return;
    actionLock.current = true;
    try {
      if (!await flushDraft()) return;
      const task = workbench.task;
      if (!await commit(state => recordMissionAttempt(state, workbench.run.id, task.id, { variantId: task.variants[0].id, ...draft }))) return;
      await advance();
    } finally { actionLock.current = false; }
  }
  async function runChecks() {
    if (actionLock.current || runRef.current || !workbench?.task || !draft) return;
    actionLock.current = true;
    const submittedRevision = editRevision.current;
    const flushed = await flushDraft();
    actionLock.current = false;
    if (!flushed || submittedRevision !== editRevision.current) return;
    const task = workbench.task, variant = task.variants[0], runId = workbench.run.id;
    const submitted = { ...draft, sourceFiles: { ...draft.sourceFiles } };
    const requestId = crypto.randomUUID();
    // Pin the current task while a passed attempt updates the next-task selector.
    const pinned = { ...route, taskId: task.id };
    window.history.replaceState({}, "", routeHash(pinned)); setRoute(pinned);
    setResult(null); setAttemptSaved(false); setStatus("Loading Python");
    runRef.current = { requestId, cancel: () => {} };
    const cancel = startGradingRun({ type: "run", requestId, exerciseId: variant.exerciseId, graderId: variant.graderId, files: submitted.sourceFiles }, async data => {
      if (runRef.current?.requestId !== requestId) return;
      runRef.current = null;
      setResult(data); setStatus(runStatus(data));
      if (!data.executionOk) return;
      const saved = await commit(state => recordMissionAttempt(state, runId, task.id, { variantId: variant.id, ...submitted, result: data }));
      if (submittedRevision === editRevision.current) setAttemptSaved(saved);
    }, undefined, 15000, phase => {
      if (runRef.current?.requestId === requestId) setStatus(phase === "loading" ? "Loading Python" : "Running checks");
    });
    if (runRef.current?.requestId === requestId) runRef.current.cancel = cancel;
  }
  function stopRun() { cancelRun(); setStatus("Ready"); setResult(null); }
  async function toggleLearningMode() {
    await commit(state => state, !learningMode);
  }
  async function retrySave() {
    if (!ready) { await hydrate(); return; }
    const store = storeRef.current;
    if (!store) return;
    try {
      const previousAttempts = stateRef.current.attempts.length;
      if (store.pending) { accept(await store.retry()); if (!store.legacy) setImportPending(false); }
      if (result?.executionOk && stateRef.current.attempts.length > previousAttempts) setAttemptSaved(true);
      if (workbench?.task || baselineItem) await flushDraft();
      else setStorageError(null);
    } catch (error) { setStorageError(error instanceof Error ? error.message : String(error)); }
  }
  function exportRecovery() {
    if (recoveryRaw === null) return;
    const url = URL.createObjectURL(new Blob([recoveryRaw], { type: "text/plain" }));
    const link = document.createElement("a"); link.href = url; link.download = "coding-school-recovery.txt"; link.click(); URL.revokeObjectURL(url);
  }
  async function retryRecovery() { await hydrate(); }
  async function resetRecovery() {
    if (recoveryRaw === null) return;
    try {
      window.localStorage.setItem(`coding-school:recovery:${Date.now()}`, recoveryRaw);
      resetState(); await hydrate(); go({ destination: "today" });
    } catch { setStorageError("Could not create a recovery backup. Export your data before freeing browser storage and retrying."); }
  }
  async function importLegacy() {
    try { if (storeRef.current) { accept(await storeRef.current.importLegacy()); setImportPending(false); } }
    catch (error) { setStorageError(error instanceof Error ? error.message : String(error)); }
  }
  async function startEmpty() {
    try { if (storeRef.current) { accept(await storeRef.current.startEmpty()); setImportPending(false); } }
    catch (error) { setStorageError(error instanceof Error ? error.message : String(error)); }
  }
  async function exportBackup() {
    try {
      const pending = storeRef.current?.pending;
      const data = pending ? { format: "coding-school-pending-v1", ...pending, localDrafts: draftRef.current } : await storeRef.current?.exportBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = pending ? "coding-school-pending.json" : "coding-school-backup.json"; link.click(); URL.revokeObjectURL(url);
    } catch (error) { setStorageError(error instanceof Error ? error.message : String(error)); }
  }
  return { state, ready, route, workbench, draft, result, status, busy, attemptSaved, learningMode, assistanceUsed, storageError, recoveryRaw, importPending, saving: saving || dirty,
    baseline,baselineItem,baselineDraft,beginBaseline,updateBaselineDraft,runBaselineChecks,answerBaseline,
    navigate, start, updateDraft, continueStage, submitText, runChecks, stopRun, toggleLearningMode, retrySave, exportRecovery, retryRecovery, resetRecovery, importLegacy, startEmpty, exportBackup };
}
export type Studio = ReturnType<typeof useStudio>;
