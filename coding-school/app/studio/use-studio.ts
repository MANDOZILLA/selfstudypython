"use client";

import { useEffect, useRef, useState } from "react";
import { advanceMissionStage, createDefaultState, getState, migrateState, resetState, StateRecoveryError, saveMissionDraft, saveState, startOrResumeMission, replaceDiagnosticSession, type LearningState, type MissionDraft } from "../../lib/state";
import { decideBoot, fetchSnapshot, pushState } from "../../lib/state-sync";
import { getWorkbenchModel, persistAttempt, runStatus, type Destination, type RunStatus } from "../../lib/studio";
import { startGradingRun, type GradeResult } from "../../lib/runner";
import { ideRequestExtras, resolveEntrypoint, sanitizeProjectFiles, type IdeVariantExtras } from "../../lib/ide";
import { answerConcept, classifyGradeResult, completeDiagnosticSession, createDiagnosticSession, recordCodingOutcome, saveDiagnosticDraft, type DiagnosticSession } from "../../lib/diagnostic";
import { gradeDiagnosticConcept } from "../../lib/diagnostic-grading";
import { DIAGNOSTIC_ITEMS } from "../../curriculum";
import { readRoute, routeHash, type Route } from "../../lib/route";

type IdeVariant = { exerciseId: string; graderId: string; skillChecks?: Record<string, string[]>; timeoutMs?: number } & IdeVariantExtras;
/** Build an IDE worker request: multi-file sources, a validated entrypoint,
 *  sanitized fixtures, per-skill check mapping, and the task timeout. */
function ideRunRequest(variant: IdeVariant, sourceFiles: Record<string, string>, requestId: string, entrypoint: string | undefined, mode: "grade" | "execute") {
  // Sanitize again at the request boundary: the worker must never see an
  // unsafe file name, however it entered the draft.
  const files = sanitizeProjectFiles(sourceFiles);
  const extras = ideRequestExtras(variant, files);
  return {
    type: "run" as const, requestId, exerciseId: variant.exerciseId, graderId: variant.graderId,
    files, mode,
    entrypoint: resolveEntrypoint(files, entrypoint ?? extras.entrypoint),
    fixtures: extras.fixtures, skillChecks: variant.skillChecks, timeoutMs: variant.timeoutMs,
  };
}

/** localStorage key for the revision this browser last synced. Lets boot tell
 *  "server is older than my last write" (restored backup) apart from "server
 *  is newer" — newer offline work must never be visibly reset. */
const SYNCED_REVISION_KEY = "coding-school:learner-state:synced-revision";

function readSyncedRevision(): number | null {
  try {
    const raw = window.localStorage.getItem(SYNCED_REVISION_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function writeSyncedRevision(revision: number): void {
  try {
    window.localStorage.setItem(SYNCED_REVISION_KEY, String(revision));
  } catch {
    /* best-effort: the next successful sync rewrites it */
  }
}

export function useStudio() {  const [state, setState] = useState(createDefaultState);
  const stateRef = useRef(state);
  const [route, setRoute] = useState<Route>({ destination: "today" });
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [recoveryRaw, setRecoveryRaw] = useState<string | null>(null);
  /** Durable-sync status. SQLite on the server is the durable source; localStorage is a write-through cache. */
  const [syncStatus, setSyncStatus] = useState<"booting" | "synced" | "saving" | "offline" | "conflict">("booting");
  const serverRevisionRef = useRef(0);
  const conflictRef = useRef<{ serverState: LearningState; serverRevision: number; localState: LearningState } | null>(null);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const STATE_URL = "/api/state";
  const BOOT_TIMEOUT_MS = 8000;
  const PUSH_DEBOUNCE_MS = 750;
  const RETRY_MS = 15000;

  // Sync helpers only touch refs and setState, so they are safe to call from any closure or timer.
  /** Push the last committed state to the durable store. Never throws and never fabricates state. */
  async function pushCommittedState(): Promise<void> {
    const revision = serverRevisionRef.current;
    const snapshot = stateRef.current;
    setSyncStatus("saving");
    const outcome = await pushState(fetch, STATE_URL, revision, snapshot);
    if ("ok" in outcome) {
      serverRevisionRef.current = outcome.revision;
      writeSyncedRevision(outcome.revision);
      dirtyRef.current = false;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      setSyncStatus("synced");
      return;
    }
    if ("conflict" in outcome) {
      // Another tab or device won the race. Keep both copies; the user decides.
      conflictRef.current = { serverState: outcome.state, serverRevision: outcome.revision, localState: snapshot };
      setSyncStatus("conflict");
      return;
    }
    if ("rejected" in outcome) {
      setStorageError(`Could not sync to the server (${outcome.reason}). Your work is safe in this browser and sync will be retried.`);
    }
    dirtyRef.current = true;
    setSyncStatus("offline");
    scheduleSyncRetry();
  }

  /** Debounced write-through push after every local commit. */
  function schedulePush() {
    dirtyRef.current = true;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => {
      pushTimerRef.current = null;
      void pushCommittedState();
    }, PUSH_DEBOUNCE_MS);
  }

  /** Retry a failed push while there is unsent work and no conflict awaiting the user. */
  function scheduleSyncRetry() {
    if (retryTimerRef.current) return;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      if (dirtyRef.current && conflictRef.current === null) void pushCommittedState();
    }, RETRY_MS);
  }
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
    /** Boot with SQLite as the durable source. The server always wins; a differing local copy is stashed, never dropped. */
    async function bootStudio(): Promise<void> {
      let local: LearningState | null = null;
      let localFailed = false;
      try { local = getState(); }
      catch (error) {
        localFailed = true;
        if (error instanceof StateRecoveryError) setRecoveryRaw(error.raw);
        else setStorageError(String(error));
      }
      const finish = () => {
        try { setLearningMode(window.localStorage.getItem("coding-school:learning-mode") !== "off"); }
        catch { setStorageError("Browser storage is unavailable. Keep this page open to preserve your draft."); }
        restore(); setReady(true);
      };
      if (localFailed) { setSyncStatus("offline"); finish(); return; }
      const fetched = await fetchSnapshot(fetch, STATE_URL, BOOT_TIMEOUT_MS);
      if (!fetched.ok) {
        // Offline: keep the exact previous behavior — local state only, nothing fabricated.
        if (local !== null) { stateRef.current = local; setState(local); }
        dirtyRef.current = true; // retry the durable write when the server is reachable
        setSyncStatus("offline");
        scheduleSyncRetry();
        finish();
        return;
      }
      const decision = decideBoot(fetched.snapshot, local, readSyncedRevision());
      if (decision.action === "adopt-server" || decision.action === "adopt-server-with-local-backup") {
        if (decision.action === "adopt-server-with-local-backup" && local !== null) {
          try { window.localStorage.setItem(`coding-school:learner-state:backup:${Date.now()}`, JSON.stringify(local)); }
          catch { /* best-effort backup of the superseded copy */ }
        }
        const adopted = migrateState(fetched.snapshot.state);
        serverRevisionRef.current = decision.revision;
        writeSyncedRevision(decision.revision);
        try {
          const saved = saveState(adopted);
          stateRef.current = saved; setState(saved);
        } catch (error) {
          // The server copy is durable; a cache failure must not lose it.
          setStorageError(`Browser cache could not be updated (${String(error)}). Your synced copy is intact.`);
          stateRef.current = adopted; setState(adopted);
        }
        setSyncStatus("synced");
        finish();
        return;
      }
      if (decision.action === "boot-conflict" && local !== null && fetched.snapshot.state) {
        // The server is OLDER than this browser's last acknowledged write
        // (e.g. restored from an older backup). Keep the newer local work on
        // screen and surface the normal conflict UI — never visibly reset it.
        serverRevisionRef.current = decision.revision;
        conflictRef.current = {
          serverState: migrateState(fetched.snapshot.state),
          serverRevision: decision.revision,
          localState: local,
        };
        stateRef.current = local; setState(local);
        dirtyRef.current = true;
        setSyncStatus("conflict");
        finish();
        return;
      }
      if (decision.action === "sync-local" && local !== null) {
        // The server is unchanged since the last sync, so the local
        // difference is strictly newer unsynced work (e.g. written while
        // offline). Keep it visible and push it up through the normal
        // debounced path instead of superseding it.
        stateRef.current = local; setState(local);
        serverRevisionRef.current = decision.revision;
        schedulePush();
        finish();
        return;
      }
      if (decision.action === "migrate-local" && local !== null) {
        stateRef.current = local; setState(local);
        serverRevisionRef.current = 0;
        schedulePush(); // PUT revision 0 through the normal debounced path
        finish();
        return;
      }
      const fresh = createDefaultState();
      stateRef.current = fresh; setState(fresh);
      serverRevisionRef.current = 0;
      writeSyncedRevision(0);
      setSyncStatus("synced");
      finish();
    }
    const frame = requestAnimationFrame(() => { void bootStudio(); });
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => {
      cancelAnimationFrame(frame);
      if (pushTimerRef.current) { clearTimeout(pushTimerRef.current); pushTimerRef.current = null; }
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", restore);
      runRef.current?.cancel();
    };
  // Boot runs exactly once. schedulePush/scheduleSyncRetry only touch refs and
  // setState, so the empty dependency array is intentional here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Resolve a sync conflict. Both copies are preserved no matter the choice. */
  async function resolveConflict(choice: "mine" | "theirs"): Promise<void> {
    const conflict = conflictRef.current;
    if (!conflict) return;
    if (choice === "theirs") {
      // Stash the local copy before adopting — never silently discarded.
      try { window.localStorage.setItem(`coding-school:learner-state:backup:${Date.now()}`, JSON.stringify(conflict.localState)); }
      catch { /* best-effort backup */ }
      try {
        const saved = saveState(migrateState(conflict.serverState));
        stateRef.current = saved; setState(saved);
      } catch (error) {
        setStorageError(`Browser cache could not be updated (${String(error)}). Your synced copy is intact.`);
        stateRef.current = conflict.serverState; setState(conflict.serverState);
      }
      serverRevisionRef.current = conflict.serverRevision;
      writeSyncedRevision(conflict.serverRevision);
      conflictRef.current = null; dirtyRef.current = false;
      setSyncStatus("synced");
      return;
    }
    // "mine": force-push the local state over the current server revision.
    setSyncStatus("saving");
    const outcome = await pushState(fetch, STATE_URL, conflict.serverRevision, stateRef.current);
    if ("ok" in outcome) {
      serverRevisionRef.current = outcome.revision;
      writeSyncedRevision(outcome.revision);
      conflictRef.current = null; dirtyRef.current = false;
      setSyncStatus("synced");
    } else if ("conflict" in outcome) {
      // Someone else wrote again while deciding — surface the newest copy.
      conflictRef.current = { serverState: outcome.state, serverRevision: outcome.revision, localState: stateRef.current };
      setSyncStatus("conflict");
    } else {
      if ("rejected" in outcome) setStorageError(`Could not sync to the server (${outcome.reason}). Your work is safe in this browser and sync will be retried.`);
      setSyncStatus("offline");
      scheduleSyncRetry();
    }
  }

  /** Download the local copy that lost a sync conflict, as JSON. */
  function exportConflictCopy() {
    const conflict = conflictRef.current;
    if (!conflict) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(conflict.localState, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "coding-school-conflict-copy.json"; link.click();
    URL.revokeObjectURL(url);
  }

  // Best-effort flush of an unsent write when the tab is hidden or closed.
  useEffect(() => {
    const flush = () => {
      if (pushTimerRef.current) { clearTimeout(pushTimerRef.current); pushTimerRef.current = null; }
      if (!dirtyRef.current || conflictRef.current !== null) return;
      const body = JSON.stringify({ revision: serverRevisionRef.current, state: stateRef.current });
      fetch(STATE_URL, { method: "PUT", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const workbench = route.runId ? getWorkbenchModel(state, route.runId, route.taskId) : null;
  const draft = workbench?.task ? localDrafts[workbench.task.id] ?? workbench.draft : undefined;
  const busy = status === "Loading Python" || status === "Loading data-science packages…" || status === "Running checks" || status === "Running code";
  const assistanceUsed = Boolean(draft && (draft.assistance.hintsUsed || draft.assistance.aiAssisted || draft.assistance.solutionViewed));

  function commit(next: LearningState) {
    if (recoveryRaw !== null) return false;
    pendingWrite.current = next;
    try {
      const saved = saveState(next); stateRef.current = saved; setState(saved); pendingWrite.current = null; setStorageError(null); schedulePush(); return true;
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
  function start(missionId?: string, reviewTaskIds?: string[]) {
    if (!flushDraft()) return;
    try {
      const next = startOrResumeMission(stateRef.current, new Date(), missionId, reviewTaskIds);
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
  function runChecks(entrypoint?: string) {
    if (runRef.current || !workbench?.task || !draft || !flushDraft()) return;
    const task = workbench.task, variant = task.variants[0], runId = workbench.run.id;
    const submitted = { ...draft, sourceFiles: { ...draft.sourceFiles } };
    const requestId = crypto.randomUUID();
    // Pin the current task while a passed attempt updates the next-task selector.
    const pinned = { ...route, taskId: task.id };
    window.history.replaceState({}, "", routeHash(pinned)); setRoute(pinned);
    setResult(null); setAttemptSaved(false); setStatus("Loading Python");
    runRef.current = { requestId, cancel: () => {} };
    const cancel = startGradingRun(ideRunRequest(variant, submitted.sourceFiles, requestId, entrypoint, "grade"), data => {
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
  /** Execute mode: run the entrypoint and show the output without grading or
   *  saving an attempt. Late results are ignored by requestId, exactly like
   *  graded runs. */
  function runCode(entrypoint?: string) {
    if (runRef.current || !workbench?.task || !draft || !flushDraft()) return;
    const variant = workbench.task.variants[0];
    const requestId = crypto.randomUUID();
    setResult(null); setAttemptSaved(false); setStatus("Loading Python");
    runRef.current = { requestId, cancel: () => {} };
    const cancel = startGradingRun(ideRunRequest(variant, draft.sourceFiles, requestId, entrypoint, "execute"), data => {
      if (runRef.current?.requestId !== requestId) return;
      runRef.current = null;
      setResult(data); setStatus(runStatus(data));
    }, undefined, variant.timeoutMs ?? 15000, phase => {
      if (runRef.current?.requestId === requestId) setStatus(phase === "loading" ? "Loading Python" : phase === "packages" ? "Loading data-science packages…" : "Running code");
    });
    if (runRef.current?.requestId === requestId) runRef.current.cancel = cancel;
  }
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
    syncStatus, resolveConflict, exportConflictCopy,
    navigate, start, updateDraft, continueStage, submitText, runChecks, runCode, stopRun, toggleLearningMode, retrySave, exportRecovery, retryRecovery, resetRecovery, downloadPortfolio, applyState,
    diagnosticResult, diagnosticStatus, diagnosticBusy, diagnosticStale,
    startDiagnostic, retakeDiagnostic, openDiagnosticSession, updateDiagnosticDraft, revealDiagnosticHint, answerDiagnosticConcept, runDiagnosticCode, stopDiagnosticRun, finishDiagnostic };
}
export type Studio = ReturnType<typeof useStudio>;
