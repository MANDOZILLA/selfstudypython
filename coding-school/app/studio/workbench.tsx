import { loader } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import type { Studio } from "./use-studio";
import { IdePane } from "./ide-pane";
import { TutorPanel } from "./tutor-panel";
import { getXpEvents } from "../../lib/progress";
import { XpToast } from "./xp-toast";
import terminal from "./terminal.module.css";
import { nextWorkbenchPanel, workbenchPanels, type WorkbenchPanel } from "../../lib/studio";
import styles from "./workbench-layout.module.css";
import {
  COMPACT_QUERY, DEFAULT_SPLITS, KEY_BIG_STEP, KEY_STEP,
  boundsFor, browserStorage, clampSplits, loadSplits, nudgeSplit, saveSplits, setSplit,
  type SplitSide, type WorkbenchSplits,
} from "./workbench-resizer";

loader.config({ paths: { vs: "/monaco/vs" } });

/** Short sync labels for the workbench header. The nav's sync note is hidden
 *  on mobile, so the header carries the only mobile-visible sync/offline
 *  indication. */
function syncLabel(status: Studio["syncStatus"]): string {
  switch (status) {
    case "booting": return "Starting…";
    case "saving": return "Saving…";
    case "synced": return "All changes saved";
    case "offline": return "Offline — changes saved in this browser";
    case "conflict": return "Sync conflict — action needed";
  }
}

function focusWorkbenchTab(panel: WorkbenchPanel) {
  document.getElementById(`tab-${panel}`)?.focus();
}

function TaskInstructions({ studio }: { studio: Studio }) {
  const { workbench, draft, result } = studio;
  const task = workbench?.task;
  if (!task) return null;
  const independentForTask = studio.learningMode && !studio.assistanceUsed;
  return <div className={`task-content ${terminal.instructions}`}>
    <span className="eyebrow">YOUR TASK</span><h2>{task.title}</h2>
    <details open><summary>{"// "}OBJECTIVE</summary><div className="task-outcome"><p>{task.explanation}</p><p>{task.kind === "code" ? task.purpose === "project" ? "Build a working Python artifact that meets every requirement." : "Build a small transformation you can reuse." : task.kind === "explanation" ? "Save an explanation of your decisions and questions." : "Understand the pattern before guided practice."}</p></div></details>
    <details><summary>{"// "}REQUIREMENTS</summary><ol className="requirements">{task.requirements.map(item => <li key={item}>{item}</li>)}</ol></details>
    <details><summary>{"// "}EXAMPLES</summary>{task.examples.map((example, index) => <figure key={index}><figcaption>{task.kind === "instruction" ? "Worked example" : "Input and expected output"} {index + 1}</figcaption><pre className="example">{example}</pre></figure>)}</details>
    {independentForTask && <p className="independent-note">Independent mode is on. Hints and solutions stay hidden.</p>}
    {draft && !independentForTask && <details className="hint-section"><summary>{"// "}HINTS ({draft.assistance.hintsUsed}/{task.hints.length} hints)</summary>{task.hints.slice(0, draft.assistance.hintsUsed).map((hint, i) => <p className="hint" key={hint}><strong>Hint {i + 1}</strong>{hint}</p>)}{draft.assistance.hintsUsed < task.hints.length && <button className="secondary" onClick={() => studio.updateDraft({ assistance: { ...draft.assistance, hintsUsed: draft.assistance.hintsUsed + 1 } })}>Reveal hint {draft.assistance.hintsUsed + 1}</button>}</details>}
    {draft && !independentForTask && <details><summary>{"// "}HELP USED</summary><p className="muted">Record help you used on this task.</p><label><input type="checkbox" checked={draft.assistance.aiAssisted} disabled={draft.assistance.aiAssisted} onChange={() => studio.updateDraft({ assistance: { ...draft.assistance, aiAssisted: true } })} /> I used external AI assistance</label><label><input type="checkbox" checked={draft.assistance.solutionViewed} disabled={draft.assistance.solutionViewed} onChange={() => studio.updateDraft({ assistance: { ...draft.assistance, solutionViewed: true } })} /> I viewed a solution</label>{task.kind === "code" && <TutorPanel visible={!studio.learningMode} taskId={task.id} taskTitle={task.title} requirements={task.requirements} hints={task.hints} hintsUsed={draft.assistance.hintsUsed} code={Object.entries(draft.sourceFiles).map(([name, content]) => `# --- ${name} ---\n${content}`).join("\n")} execution={result?.execution ?? null} failedTests={result?.tests?.filter(test => !test.passed).map(test => test.name) ?? []} taskUrl={typeof window === "undefined" ? "#" : window.location.hash || "#"} onTutorUsed={() => studio.updateDraft({ assistance: { ...draft.assistance, aiAssisted: true } })} />}</details>}
  </div>;
}

function Checks({ studio }: { studio: Studio }) {
  const { result, status, busy, attemptSaved, workbench } = studio;
  const restored = !result && workbench?.taskComplete ? workbench.latestAttempt : undefined;
  const executed = (result as { mode?: string } | null)?.mode === "executed";
  const execution = (result as { execution?: { status: string; file?: string; line?: number; message?: string } } | null)?.execution;
  const executionSummary = execution?.status === "ok" ? "Ran successfully — no errors."
    : execution ? `${execution.file ? `File “${execution.file}”${execution.line ? `, line ${execution.line}` : ""}` : "The program"}: ${execution.message || "an error occurred"}` : "";
  return <section className={`checks-panel term ${terminal.checks}`} aria-label="Checks and output" aria-busy={busy} tabIndex={-1} id="checks-panel">
    <p className="term-prompt">$ run checks</p>
    <div className="checks-heading"><h2>{executed ? "Run output" : "Checks"}</h2><span className={`run-status ${status === "Passed" || status === "Ran successfully" ? "success" : ["Needs changes", "Timed out", "Couldn't run", "Run failed"].includes(status) ? "failure" : ""}`} role="status" aria-live="polite">{restored ? restored.passed ? "Passed · saved attempt" : "Review attempted" : status}{busy ? " ▋" : ""}</span></div>
    {busy ? <p className="checks-message">{status === "Loading Python" ? "Starting Python in your browser. Your code stays here." : status === "Running code" ? "Running your entrypoint." : "Testing your returned values and required Python concepts."}</p> : result ? <>
      {executed ? <p className="checks-message">{result.executionOk ? "This run is not graded and is not saved as an attempt." : `${executionSummary} This run is not saved as an attempt.`}</p>
      : <p className="checks-message">{result.passed ? attemptSaved ? workbench?.task?.purpose === "project" ? "Required checks passed. Your project attempt is saved." : "Required checks passed. Your practice attempt is saved." : "Checks passed, but this attempt has not been saved. Retry saving or run again." : attemptSaved ? "Attempt saved. Use the checks below to decide what to change." : "This attempt has not been saved. Your code is preserved."}</p>}
      {!executed && <ul className="check-results">{result.tests.map(check => <li key={check.id} className={check.passed ? "check-pass" : "check-fail"}><span aria-hidden="true">{check.passed ? "✓" : "×"}</span><div><strong><span className="visually-hidden">{check.passed ? "Passed" : "Needs changes"}: </span>[{check.passed ? "PASS" : "FAIL"}] {check.name}</strong> <span className="chip chip-amber">[REQ] {check.required ? "required" : "optional"}</span>{check.detail && <p>{check.detail}</p>}{!check.passed && <p className="next-action">Next: {check.id === "execution" ? "Check the message below, then try Run checks again." : "Update the code for this requirement, then run the checks again."}</p>}</div></li>)}</ul>}
      {executed && !result.executionOk && <p className="execution-error" role="alert">{executionSummary}</p>}
    </> : restored ? <p className="checks-message">{restored.passed ? "This draft matches your saved passed attempt. Continue when you’re ready." : "Your review attempt is saved. You can continue or try again."}</p> : <p className="checks-message">Run your code to see its output, or run it against the requirements. Printing an answer alone does not pass the checks.</p>}
    {result && (result.stdout || result.stderr) ? <div className={`console-output ${styles.console}`}>
      <h3>--- stdout ---</h3>
      {result.stdout && <><p className={styles.consoleLabel}>Standard output</p><pre>{result.stdout}</pre></>}
      {result.stderr && <><p className={`${styles.consoleLabel} ${styles.consoleLabelError}`}>Standard error</p><pre>{result.stderr}</pre></>}
    </div> : <p className="muted">{result ? "Your program produced no standard output or errors." : "Standard output and errors from your run appear here."}</p>}
  </section>;
}

/** Focusable splitter between two workbench panes: pointer drag on desktop,
 *  arrow keys from the keyboard (Shift = larger step, Home/End = extremes).
 *  Desktop three-pane flow only — never rendered while the tabbed single-pane
 *  flow is active (mobile, or desktop narrower than THREE_PANE_MIN_WIDTH). */
function PaneResizer({ side, splits, width, onPointerDown, onPointerMove, onPointerUp, onKeyDown }: {
  side: SplitSide;
  splits: WorkbenchSplits;
  width: number;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const value = Math.round(splits[side] * 100);
  // Announce the range the clamp can actually deliver at this row width: the
  // pixel floors raise the min and cap the max, so the authored fractions would
  // promise a value Home/End can never reach (the separator stops short of the
  // number the screen reader announces).
  const bounds = boundsFor(side, width > 0 ? width : undefined);
  const min = Math.round(bounds.min * 100);
  const max = Math.round(bounds.max * 100);
  const panes = side === "left" ? ["instructions", "code"] : ["code", "checks"];
  const paneName = side === "left" ? "Instructions" : "Checks";
  const now = Math.min(Math.max(value, min), max);
  return <div
    className={styles.separator}
    data-split={side}
    role="separator"
    aria-orientation="vertical"
    aria-label={`Resize ${panes[0]} and ${panes[1]} panes`}
    aria-controls={`panel-${panes[0]} panel-${panes[1]}`}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={now}
    aria-valuetext={`${paneName} pane width ${now} percent`}
    tabIndex={0}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerCancel={onPointerUp}
    onKeyDown={onKeyDown}
  />;
}

export function Workbench({ studio }: { studio: Studio }) {
  const [panel, setPanel] = useState<WorkbenchPanel>("instructions");
  const [xpToast, setXpToast] = useState<number | null>(null);
  const seenAttempts = useRef(new Set((studio.state?.attempts ?? []).map(attempt => attempt.id)));
  const pendingPass = useRef<string | null>(null);
  // Tabbed single-pane flow: mobile (<1024px) and narrow desktop (1024-1199px,
  // where three panes plus separators cannot fit beside the 224px nav).
  // Defaults to false so SSR and the first paint ship the three-pane markup.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const sync = () => setCompact(query.matches);
    sync(); query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const { workbench, draft } = studio;
  // The Continue / save buttons unmount when the task advances: move focus to
  // the page heading so keyboard and screen-reader users aren't dropped to <body>.
  // (Declared before the early return below to keep hook order stable. Only
  // fires on task-to-task transitions, never on initial mount.)
  const taskId = workbench?.task?.id;
  useEffect(() => {
    const fresh = (studio.state?.attempts ?? []).filter(attempt => !seenAttempts.current.has(attempt.id));
    for (const attempt of fresh) seenAttempts.current.add(attempt.id);
    const passed = fresh.find(attempt => attempt.passed && attempt.executionOk && attempt.taskId === taskId);
    if (passed) pendingPass.current = passed.id;
    if (!studio.attemptSaved || !pendingPass.current) return;
    const event = getXpEvents(studio.state).find(item => item.id.endsWith(`:${pendingPass.current}`));
    pendingPass.current = null;
    if (event) setXpToast(event.xp);
  }, [studio.attemptSaved, studio.state, taskId]);
  const prevTaskId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevTaskId.current !== undefined && prevTaskId.current !== taskId) {
      document.getElementById("page-title")?.focus({ preventScroll: true });
    }
    prevTaskId.current = taskId;
  }, [taskId]);
  // Desktop three-pane sizing. Defaults render first (SSR-safe), then the
  // stored proportions hydrate from localStorage and a ResizeObserver keeps
  // them inside their bounds when the window changes size.
  const [splits, setSplits] = useState<WorkbenchSplits>(DEFAULT_SPLITS);
  // Live width of the layout row, published to the separators so their aria
  // ranges match what clampSplits can deliver at that width. 0 until the first
  // client-side measure, so SSR keeps the authored (width-free) ranges.
  const [rowWidth, setRowWidth] = useState(0);
  const splitsRef = useRef<WorkbenchSplits>(DEFAULT_SPLITS);
  const layoutRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ side: SplitSide; startX: number; start: WorkbenchSplits; width: number } | null>(null);
  function layoutWidth(): number {
    return layoutRef.current?.getBoundingClientRect().width ?? 0;
  }
  /** Re-clamp against the live row. `keep` names the pane the user is moving so
   *  a width mismatch between the gesture and this measure can never hand the
   *  room to the other pane (which would move the separator the wrong way). */
  function applySplits(next: WorkbenchSplits, persist: boolean, keep?: SplitSide) {
    const width = layoutWidth();
    const clamped = clampSplits(next, width > 0 ? width : undefined, keep);
    splitsRef.current = clamped;
    setSplits(clamped);
    if (persist) saveSplits(browserStorage(), clamped);
  }
  function startDrag(side: SplitSide, event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const width = layoutWidth();
    if (!width) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { side, startX: event.clientX, start: splitsRef.current, width };
    document.body.classList.add("wb-dragging");
  }
  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = (event.clientX - drag.startX) / drag.width;
    const value = drag.side === "left" ? drag.start.left + delta : drag.start.right - delta;
    applySplits(setSplit(drag.start, drag.side, value, drag.width), false, drag.side);
  }
  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.classList.remove("wb-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    saveSplits(browserStorage(), splitsRef.current);
  }
  function resizeByKey(side: SplitSide, event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const width = layoutWidth();
    const boundsWidth = width > 0 ? width : undefined;
    const step = (event.shiftKey ? KEY_BIG_STEP : KEY_STEP) * (event.key === "ArrowRight" ? 1 : -1);
    const next = event.key === "Home" || event.key === "End"
      ? setSplit(splitsRef.current, side, boundsFor(side, boundsWidth)[event.key === "Home" ? "min" : "max"], boundsWidth)
      : nudgeSplit(splitsRef.current, side, side === "left" ? step : -step, boundsWidth);
    applySplits(next, true, side);
  }
  useEffect(() => {
    const node = layoutRef.current;
    const width = node?.getBoundingClientRect().width ?? 0;
    const loaded = clampSplits(loadSplits(browserStorage()), width > 0 ? width : undefined);
    splitsRef.current = loaded;
    setSplits(loaded);
    if (width > 0) setRowWidth(width);
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const observed = node.getBoundingClientRect().width;
      if (observed <= 0) return;
      setRowWidth(observed);
      setSplits(current => {
        const next = clampSplits(current, observed);
        splitsRef.current = next;
        return next;
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  if (!workbench) return null;
  const { mission, run, stage, task } = workbench;
  const nextStage = mission.stages[run.stageIndex + 1];
  const continueLabel = workbench.stageComplete ? run.mode === "review" ? "Finish review" : nextStage ? `Continue to ${nextStage.title}` : "Finish mission" : "Continue to next task";
  return <main className="workbench" id="main-content">
    <header className={`workbench-heading ${terminal.header}`}><div className="workbench-topline"><button className="text-button" onClick={() => studio.navigate("today")}>‹ HOME</button><label className="learning-toggle"><input type="checkbox" checked={studio.learningMode} onChange={studio.toggleLearningMode} /><span>Independent mode</span></label><span className={terminal.sync} role="status" title={syncLabel(studio.syncStatus)} aria-label={syncLabel(studio.syncStatus)}>{syncLabel(studio.syncStatus)}</span></div><div className="workbench-title"><h1 id="page-title" tabIndex={-1}>{run.mode === "review" ? "Scheduled skill review" : mission.title}</h1><span>{run.mode === "review" ? stage.estimatedMinutes : mission.estimatedMinutes} min</span></div><div className={terminal.mode}><details><summary aria-label="About independent mode">?</summary><p>{studio.learningMode && studio.assistanceUsed ? "This task stays recorded as assisted. Independent mode applies when you start the next task; prior help cannot be erased." : studio.learningMode ? "Independent work hides hints and solutions. Help is not recorded." : studio.assistanceUsed ? "Help used on this task is recorded and stays in your record." : "Use hints one at a time. Any help you use is recorded."}</p></details></div><ol className={terminal.pipeline} aria-label="Mission stages">{["REVIEW", "LEARN", "BUILD", "EXPLAIN"].map((label, index) => <li key={label} className={index === run.stageIndex ? terminal.current : index < run.stageIndex ? terminal.done : ""} aria-current={index === run.stageIndex ? "step" : undefined}>{index < run.stageIndex ? "✓ " : index === run.stageIndex ? "› " : ""}{label}</li>)}</ol></header>
    {!task ? <section className="stage-document document"><span className="eyebrow">REVIEW · {stage.estimatedMinutes} MIN PLANNED</span><h2>No review is due for this mission.</h2><p>Your review schedule begins after you learn and practise. Use this moment to read the mission outcome, then begin the lesson.</p><div className="review-outcome"><span className="eyebrow">BY THE END</span><h3>{mission.stages[2].tasks[0]?.title}</h3><p>{mission.summary}</p></div><p className="muted">The stage times are a suggested {mission.estimatedMinutes}-minute guide, not a countdown.</p><button className="primary" onClick={studio.continueStage}>Continue to Learn →</button></section> : task.kind !== "code" ? <section className="reading-layout"><article className="document reading-document"><TaskInstructions studio={studio} />{task.kind === "explanation" && draft && <div className="reflection-input"><label htmlFor="reflection">Your explanation</label><textarea id="reflection" value={draft.response} onChange={event => studio.updateDraft({ response: event.target.value })} placeholder="Describe one decision, a concrete example, and what you’re still unsure about." rows={7} /><span className="muted">At least 20 characters. Your reflection is saved, not automatically graded.</span></div>}<footer className="reading-action"><p>{task.kind === "instruction" ? "Reading records exposure. Guided practice comes next." : "Save this reflection to complete your mission."}</p><button className="primary" disabled={task.kind === "explanation" && (draft?.response.trim().length ?? 0) < 20} onClick={studio.submitText}>{task.kind === "instruction" ? "I’ve read the examples · Start practice" : "Save reflection & finish"} →</button></footer></article><aside className="reading-aside"><span className="eyebrow">{stage.title.toUpperCase()}</span><h2>{task.kind === "instruction" ? "Understand it before you build it." : "Make your thinking visible."}</h2><p>{task.kind === "instruction" ? "Trace the examples in order. Notice what each function accepts, what it rejects, and what it returns." : "A passed check shows behavior. Your explanation captures why the behavior is correct."}</p><span className="reading-file">main.py<span>Next: {task.kind === "instruction" ? "guided practice" : "saved evidence"}</span></span></aside></section> : <>
      <div className={`workbench-tabs ${styles.tabs}`} role="tablist" aria-label="Workbench panels">{workbenchPanels.map(item => <button key={item} role="tab" id={`tab-${item}`} aria-controls={`panel-${item}`} aria-selected={panel === item} tabIndex={panel === item ? 0 : -1} onClick={() => setPanel(item)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = nextWorkbenchPanel(item, event.key); setPanel(next); document.getElementById(`tab-${next}`)?.focus(); } }}>{item === "instructions" ? "Instructions" : item === "code" ? "Code" : "Checks"}</button>)}</div>
      <div className={`coding-layout active-${panel} ${styles.layout}`} ref={layoutRef} style={{ "--wb-left": `${(splits.left * 100).toFixed(3)}%`, "--wb-right": `${(splits.right * 100).toFixed(3)}%` } as React.CSSProperties}><section className="instruction-pane" id="panel-instructions" role={compact ? "tabpanel" : "region"} aria-labelledby={compact ? "tab-instructions" : undefined} aria-label={compact ? undefined : "instructions"} hidden={compact && panel !== "instructions"}><TaskInstructions studio={studio} /><button className="primary mobile-code-action" onClick={() => { setPanel("code"); focusWorkbenchTab("code"); }}>Open code →</button></section>{!compact && <PaneResizer side="left" splits={splits} width={rowWidth} onPointerDown={event => startDrag("left", event)} onPointerMove={moveDrag} onPointerUp={endDrag} onKeyDown={event => resizeByKey("left", event)} />}<section className="code-pane" id="panel-code" role={compact ? "tabpanel" : "region"} aria-labelledby={compact ? "tab-code" : undefined} aria-label={compact ? undefined : "code"} hidden={compact && panel !== "code"}><IdePane key={task.id} studio={studio} onAfterRun={() => { setPanel("checks"); if (compact) document.getElementById("checks-panel")?.focus(); }} /></section>{!compact && <PaneResizer side="right" splits={splits} width={rowWidth} onPointerDown={event => startDrag("right", event)} onPointerMove={moveDrag} onPointerUp={endDrag} onKeyDown={event => resizeByKey("right", event)} />}<div className="checks-wrap" id="panel-checks" role={compact ? "tabpanel" : "region"} aria-labelledby={compact ? "tab-checks" : undefined} aria-label={compact ? undefined : "checks"} hidden={compact && panel !== "checks"}><Checks studio={studio} /><div className="mobile-check-actions">{studio.busy && <button className="primary" onClick={studio.stopRun}>Stop run</button>}<button className="secondary" onClick={() => { setPanel("code"); focusWorkbenchTab("code"); }}>← Edit code</button>{workbench.taskComplete && !studio.storageError && <button className="primary" onClick={studio.continueStage}>{continueLabel} →</button>}</div></div></div>
    </>}
    <XpToast xp={xpToast} onDismiss={() => setXpToast(null)} />
  </main>;
}
