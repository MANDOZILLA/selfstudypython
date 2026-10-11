"use client";
import Editor, { loader } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import type { Studio } from "./use-studio";
import { DIAGNOSTIC_ITEMS, DIAGNOSTIC_SKILLS, type DiagnosticItem } from "../../curriculum";
import {
  DIAGNOSTIC_CODING_QUOTA,
  DIAGNOSTIC_MAX_ITEMS,
  DIAGNOSTIC_UNKNOWN_ANSWER,
  canCompleteDiagnostic,
  codingUnknownCount,
  deriveDiagnosticProfile,
  type DiagnosticSession,
} from "../../lib/diagnostic";
import { startGradingRun, type GradeResult, type GradeRequest } from "../../lib/runner";
import { runStatus } from "../../lib/studio";
import { defineSnakepitThemes, monacoThemeFor, useTheme } from "./theme";
import styles from "./diagnostic-layout.module.css";
import { DiagnosticPrompt } from "./diagnostic-prompt";
import {
  COMPACT_QUERY, DEFAULT_SPLITS, KEY_BIG_STEP, KEY_STEP, MIN_FRACTION,
  boundsFor, clampSplits, maxFraction, nudgeSplit, setSplit,
  type SplitSide, type WorkbenchSplits,
} from "./workbench-resizer";

loader.config({ paths: { vs: "/monaco/vs" } });

const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const SKILL_TITLE_OVERRIDES: Record<string, string> = {
  "csp-foundations": "Programs and algorithms",
  "csp-data-systems": "Data and systems",
};
const skillTitle = (skillId: string) => SKILL_TITLE_OVERRIDES[skillId] ?? DIAGNOSTIC_SKILLS.find(s => s.id === skillId)?.title ?? "Skill";
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Mobile tab order for the coding view: instructions, code, checks. */
const CODING_PANELS = ["instructions", "code", "checks"] as const;
export type DiagnosticCodingPanel = (typeof CODING_PANELS)[number];

/** Roving-tab keyboard navigation across the mobile coding tabs. */
export function nextDiagnosticPanel(current: DiagnosticCodingPanel, key: string): DiagnosticCodingPanel {
  const index = CODING_PANELS.indexOf(current);
  if (key === "ArrowRight") return CODING_PANELS[(index + 1) % CODING_PANELS.length];
  if (key === "ArrowLeft") return CODING_PANELS[(index - 1 + CODING_PANELS.length) % CODING_PANELS.length];
  if (key === "Home") return CODING_PANELS[0];
  if (key === "End") return CODING_PANELS[CODING_PANELS.length - 1];
  return current;
}

function ProgressBar({ answered }: { answered: number }) {
  return <div className={styles.segmentedProgress} role="progressbar" aria-valuenow={answered} aria-valuemin={0} aria-valuemax={DIAGNOSTIC_MAX_ITEMS} aria-label="Placement scan progress">
    {Array.from({ length: DIAGNOSTIC_MAX_ITEMS }, (_, index) => <span key={index} className={index < answered ? styles.segmentFilled : undefined} />)}
  </div>;
}

function Hints({ item, revealed, onReveal }: { item: DiagnosticItem; revealed: number; onReveal: () => void }) {
  if (!item.hints.length) return null;
  const shown = item.hints.slice(0, revealed);
  return <div className="diagnostic-hints">
    {shown.map((hint, index) => <p key={index} className="muted"><strong>Hint {index + 1}:</strong> {hint}</p>)}
    {revealed < item.hints.length && <button className="text-button" onClick={onReveal}>Reveal hint {revealed + 1} of {item.hints.length}</button>}
  </div>;
}

/** Worker request for the concept-question Python sandbox. Execute-only:
 *  runner.js skips the grader entirely in mode "execute", so the identifiers
 *  only have to satisfy protocol.validRequest (non-empty requestId, a named
 *  .py entrypoint present in files). It never grades, never returns a passing
 *  result, and carries no submitted solution — just the scratch buffer. */
export function conceptRunRequest(requestId: string, session: DiagnosticSession, item: DiagnosticItem, code: string): GradeRequest {
  return {
    type: "run",
    requestId,
    exerciseId: item.id,
    graderId: "",
    files: { "main.py": code },
    entrypoint: "main.py",
    sessionId: session.id,
    taskId: item.id,
    mode: "execute",
  };
}

/** What the sandbox output pane should render for a finished (or absent) run. */
export type ConceptSandboxOutput =
  | { kind: "idle" }
  | { kind: "no-output" }
  | { kind: "output"; stdout: string; stderr: string }
  | { kind: "error"; message: string; stdout: string };

export function conceptSandboxOutput(result: GradeResult | null): ConceptSandboxOutput {
  if (!result) return { kind: "idle" };
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (!result.executionOk) return { kind: "error", message: stderr, stdout };
  if (!stdout && !stderr) return { kind: "no-output" };
  return { kind: "output", stdout, stderr };
}

/** Scratch editor binding: the value IS the persisted session.draftCode (a
 *  concept question has no starter solution, so clearing really clears), and
 *  every keystroke patches only `code` — never the written answer. */
export function conceptScratchDraft(session: DiagnosticSession, studio: Studio) {
  return {
    value: session.draftCode,
    onChange: (code: string) => studio.updateDiagnosticDraft({ code }),
  };
}

export type ConceptRunState = { requestId: string | null; busy: boolean; status: string; result: GradeResult | null };
export const CONCEPT_RUN_IDLE: ConceptRunState = { requestId: null, busy: false, status: "Ready", result: null };

/** Scratch Python sandbox: editor on top, run controls under it, and an
 *  output pane that is always on screen. Presentation only — the parent owns
 *  the run state, so the same markup renders idle, loading, stopped, and
 *  finished runs. */
export function ConceptSandbox({ studio, session, item, run, onRun, onStop }: {
  studio: Studio; session: DiagnosticSession; item: DiagnosticItem;
  run: ConceptRunState; onRun: () => void; onStop: () => void;
}) {
  const [plainEditor, setPlainEditor] = useState(false);
  const { theme } = useTheme();
  const monacoTheme = monacoThemeFor(theme);
  const scratch = conceptScratchDraft(session, studio);
  const code = scratch.value;
  const output = conceptSandboxOutput(run.result);
  const statusLine = run.busy ? run.status : run.result ? run.status : "Ready to run";
  return <div className={styles.conceptSandbox}>
    <div className="editor-toolbar"><span>main.py <small>Python sandbox</small></span><button className="text-button" onClick={() => setPlainEditor(!plainEditor)}>{plainEditor ? "Use code editor" : "Use plain text"}</button></div>
    <div className="editor-canvas">{plainEditor
      ? <textarea className="plain-editor" aria-label="Python code" value={code} spellCheck={false} onChange={event => scratch.onChange(event.target.value)} />
      : <Editor path={`diagnostic/${session.id}/${item.id}/main.py`} language="python" theme={monacoTheme} beforeMount={defineSnakepitThemes} value={code}
        onChange={value => scratch.onChange(value ?? "")}
        loading={<p className="editor-loading">Loading code editor… You can also choose “Use plain text”.</p>}
        options={{ minimap: { enabled: false }, fontFamily: "IBM Plex Mono, monospace", fontSize: 13, lineHeight: 22, padding: { top: 16 }, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on", tabSize: 4, ariaLabel: "Scratch Python editor. This code is never graded. Press Escape then Tab to leave the editor.", accessibilitySupport: "on", fixedOverflowWidgets: true }} />}</div>
    <div className="editor-actions">
      <button id="diagnostic-run-scratch" className="primary" disabled={run.busy} onClick={onRun}>
        {run.busy ? run.status : "Run Python"}<span aria-hidden="true"> ▷</span>
      </button>
      {run.busy && <button className="secondary" onClick={onStop}>Stop run</button>}
      <span className="save-indicator" role="status">{studio.storageError ? "Not saved" : "Draft saved locally"}</span>
    </div>
    <div className={styles.scratchOutput} role="status" aria-live="polite" aria-label="Scratch run output">
      <span className={styles.scratchStatus}>{statusLine}</span>
      {output.kind === "idle" && <p className="muted">Run your Python to see its output here. This sandbox is practice only: nothing it prints is graded, recorded, or counted as evidence.</p>}
      {output.kind === "no-output" && <p className="muted">Your program finished without printing anything.</p>}
      {output.kind === "error" && <div className={styles.scratchError}>
        <p><strong>The run stopped with an error.</strong> {output.message || "No error message was returned."}</p>
        {output.stdout && <><p className={styles.consoleLabel}>Standard output</p><pre>{output.stdout}</pre></>}
      </div>}
      {output.kind === "output" && <div className={`console-output ${styles.console}`}>
        <h4>Program output</h4>
        {output.stdout && <><p className={styles.consoleLabel}>Standard output</p><pre>{output.stdout}</pre></>}
        {output.stderr && <><p className={`${styles.consoleLabel} ${styles.consoleLabelError}`}>Standard error</p><pre>{output.stderr}</pre></>}
      </div>}
    </div>
  </div>;
}

function ConceptItem({ studio, session, item }: { studio: Studio; session: DiagnosticSession; item: DiagnosticItem }) {
  const [run, setRun] = useState<ConceptRunState>(CONCEPT_RUN_IDLE);
  const cancelRef = useRef<{ requestId: string; cancel: () => void } | null>(null);

  // The run belongs to exactly one question. DiagnosticBody keys ConceptItem
  // on session + item, so leaving the question (or the studio) unmounts this
  // component, cancels the worker, and drops any output still in flight.
  useEffect(() => () => {
    cancelRef.current?.cancel();
    cancelRef.current = null;
  }, []);

  function runScratch() {
    if (cancelRef.current) return;
    const requestId = crypto.randomUUID();
    // Register before starting so an early callback still finds its own id;
    // a mismatched id means the run was superseded and the output is stale.
    cancelRef.current = { requestId, cancel: () => {} };
    setRun({ requestId, busy: true, status: "Loading Python", result: null });
    const cancel = startGradingRun(
      conceptRunRequest(requestId, session, item, session.draftCode),
      result => {
        if (cancelRef.current?.requestId !== requestId) return;
        cancelRef.current = null;
        setRun({ requestId, busy: false, status: runStatus(result), result });
      },
      undefined,
      15000,
      phase => {
        if (cancelRef.current?.requestId !== requestId) return;
        const status = phase === "loading" ? "Loading Python" : "Running code";
        setRun(current => current.requestId === requestId && current.busy ? { ...current, status } : current);
      },
    );
    if (cancelRef.current?.requestId === requestId) cancelRef.current = { requestId, cancel };
  }

  function stopScratch() {
    cancelRef.current?.cancel();
    cancelRef.current = null;
    setRun(CONCEPT_RUN_IDLE);
  }

  return <section className={`document ${styles.concept}`} aria-label="Diagnostic question">
    <div className={styles.conceptHead}>
      <div className={styles.questionMeta}><span className="chip chip-cyan">Q {session.responses.length + 1}</span><span className="chip chip-violet">{skillTitle(item.skillId)}</span></div>
      <DiagnosticPrompt prompt={item.prompt} />
      <Hints item={item} revealed={session.draftHints} onReveal={studio.revealDiagnosticHint} />
    </div>
    <div className={styles.conceptAnswer}>
      <label className="diagnostic-answer-label" htmlFor="diagnostic-answer">Your answer</label>
      <textarea id="diagnostic-answer" className="diagnostic-answer" rows={4} value={session.draftAnswer}
        onChange={event => studio.updateDiagnosticDraft({ answer: event.target.value })}
        placeholder="Explain in your own words…" />
      <div className="button-row">
        <button className="primary" onClick={studio.answerDiagnosticConcept} disabled={!session.draftAnswer.trim()}>Submit answer →</button>
        <button className={`secondary ${styles.unknownOption}`} onClick={studio.markDiagnosticUnknown} title="Record a knowledge gap instead of answering. It is never graded.">{DIAGNOSTIC_UNKNOWN_ANSWER}</button>
      </div>
      <p className="muted">Your answer is saved as you type. It never affects your grade — it only calibrates your starting point. Stuck? Choose “{DIAGNOSTIC_UNKNOWN_ANSWER}”: it is recorded as a knowledge gap, never graded.</p>
    </div>
    <ConceptSandbox studio={studio} session={session} item={item} run={run} onRun={runScratch} onStop={stopScratch} />
  </section>;
}

function CodingChecks({ studio }: { studio: Studio }) {
  const result = studio.diagnosticResult;
  const heading = result || studio.diagnosticBusy ? studio.diagnosticStatus : "Checks and output";
  return <section className="checks-panel" aria-label="Checks and output">
    <div role="status" aria-live="polite"><h3>{heading}</h3></div>
    {!result && <p className="muted">{studio.diagnosticBusy
      ? "Running your code in this browser. Nothing is recorded until the run finishes."
      : "Run your Python to see each check, its result, and the console output. Nothing here is graded until you run it, and a failing check never blocks you."}</p>}
    {result && <>
      <ul className="check-results">
        {result.tests.map(test => <li key={test.id} className={test.passed ? "check-pass" : "check-fail"}>
          <strong>{test.passed ? "Passed" : "Needs changes"}:</strong> {test.name}
          {test.detail && <p>{test.detail}</p>}
        </li>)}
      </ul>
      {(result.stdout || result.stderr) ? <div className={`console-output ${styles.console}`}>
        <h4>Console output</h4>
        {result.stdout && <><p className={styles.consoleLabel}>Standard output</p><pre>{result.stdout}</pre></>}
        {result.stderr && <><p className={`${styles.consoleLabel} ${styles.consoleLabelError}`}>Standard error</p><pre>{result.stderr}</pre></>}
      </div> : <p className="muted">Your program produced no standard output or errors.</p>}
    </>}
  </section>;
}

/** Focusable splitter between two coding panes: pointer drag on desktop,
 *  arrow keys from the keyboard (Shift = larger step, Home/End = extremes).
 *  Desktop only — unrendered while the mobile tab flow is active. */
function CodingSeparator({ side, splits, onPointerDown, onPointerMove, onPointerUp, onKeyDown }: {
  side: SplitSide;
  splits: WorkbenchSplits;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const value = Math.round(splits[side] * 100);
  const min = Math.round(MIN_FRACTION[side] * 100);
  const max = Math.round(maxFraction(side) * 100);
  const panes = side === "left" ? ["instructions", "code"] : ["code", "checks"];
  const paneName = side === "left" ? "Instructions" : "Checks";
  return <div
    className={styles.separator}
    data-split={side}
    role="separator"
    aria-orientation="vertical"
    aria-label={`Resize ${panes[0]} and ${panes[1]} panes`}
    aria-controls={`diagnostic-panel-${panes[0]} diagnostic-panel-${panes[1]}`}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={Math.min(Math.max(value, min), max)}
    aria-valuetext={`${paneName} pane width ${value} percent`}
    tabIndex={0}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerCancel={onPointerUp}
    onKeyDown={onKeyDown}
  />;
}

function CodingItem({ studio, session, item }: { studio: Studio; session: DiagnosticSession; item: DiagnosticItem }) {
  const [plainEditor, setPlainEditor] = useState(false);
  const [panel, setPanel] = useState<DiagnosticCodingPanel>("instructions");
  const [mobile, setMobile] = useState(false);
  const { theme } = useTheme();
  const monacoTheme = monacoThemeFor(theme);
  const [splits, setSplits] = useState<WorkbenchSplits>(DEFAULT_SPLITS);
  const splitsRef = useRef<WorkbenchSplits>(DEFAULT_SPLITS);
  const layoutRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ side: SplitSide; startX: number; start: WorkbenchSplits; width: number } | null>(null);

  useEffect(() => {
    // Same tabbed-flow handoff as the workbench: below THREE_PANE_MIN_WIDTH
    // (1200px) the three panes cannot fit beside the nav, so tabs own the view.
    const query = window.matchMedia(COMPACT_QUERY);
    const sync = () => setMobile(query.matches);
    sync(); query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const node = layoutRef.current;
    const width = node?.getBoundingClientRect().width ?? 0;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const observed = node.getBoundingClientRect().width;
      if (observed <= 0) return;
      setSplits(current => {
        const next = clampSplits(current, observed);
        splitsRef.current = next;
        return next;
      });
    });
    if (width > 0) splitsRef.current = clampSplits(splitsRef.current, width);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function layoutWidth(): number {
    return layoutRef.current?.getBoundingClientRect().width ?? 0;
  }
  function applySplits(next: WorkbenchSplits) {
    const width = layoutWidth();
    const clamped = clampSplits(next, width > 0 ? width : undefined);
    splitsRef.current = clamped;
    setSplits(clamped);
  }
  function startDrag(side: SplitSide, event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const width = layoutWidth();
    if (!width) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { side, startX: event.clientX, start: splitsRef.current, width };
    document.body.classList.add("dg-dragging");
  }
  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = (event.clientX - drag.startX) / drag.width;
    const value = drag.side === "left" ? drag.start.left + delta : drag.start.right - delta;
    applySplits(setSplit(drag.start, drag.side, value, drag.width));
  }
  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.classList.remove("dg-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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
    applySplits(next);
  }
  function selectPanel(next: DiagnosticCodingPanel) {
    setPanel(next);
    if (mobile) requestAnimationFrame(() => document.getElementById(`diagnostic-tab-${next}`)?.focus());
  }
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: DiagnosticCodingPanel) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    selectPanel(nextDiagnosticPanel(current, event.key));
  }

  const coding = item.coding!;
  const code = session.draftCode.trim() ? session.draftCode : coding.starterCode;
  const activeClass = panel === "instructions" ? styles.activeInstructions : panel === "code" ? styles.activeCode : styles.activeChecks;
  const panelProps = (name: DiagnosticCodingPanel) => ({
    role: mobile ? ("tabpanel" as const) : ("region" as const),
    "aria-labelledby": mobile ? `diagnostic-tab-${name}` : undefined,
    "aria-label": mobile ? undefined : `Diagnostic ${name === "instructions" ? "instructions" : name === "code" ? "code editor" : "checks and output"}`,
    hidden: mobile && panel !== name,
  });
  return <div
    className={`diagnostic-coding ${styles.layout} ${activeClass}`}
    ref={layoutRef}
    style={{ "--dg-left": `${(splits.left * 100).toFixed(3)}%`, "--dg-right": `${(splits.right * 100).toFixed(3)}%` } as React.CSSProperties}>
    <div className={styles.tabs} role="tablist" aria-label="Diagnostic coding panels">
      {CODING_PANELS.map(name => <button
        key={name}
        type="button"
        id={`diagnostic-tab-${name}`}
        role="tab"
        aria-controls={`diagnostic-panel-${name}`}
        aria-selected={panel === name}
        tabIndex={panel === name ? 0 : -1}
        onClick={() => setPanel(name)}
        onKeyDown={event => onTabKeyDown(event, name)}>
        {name === "instructions" ? "Instructions" : name === "code" ? "Code" : "Checks"}
      </button>)}
    </div>
    <section className={`instruction-pane ${styles.instructions}`} id="diagnostic-panel-instructions" {...panelProps("instructions")}>
      <div className={styles.questionMeta}><span className="chip chip-cyan">Q {session.responses.length + 1}</span><span className="chip chip-violet">{skillTitle(item.skillId)}</span></div>
      <DiagnosticPrompt prompt={item.prompt} />
      <Hints item={item} revealed={session.draftHints} onReveal={studio.revealDiagnosticHint} />
      <p className="muted">Not sure? Choose “{DIAGNOSTIC_UNKNOWN_ANSWER}” beside Run checks. It is recorded as a knowledge gap — never graded, and it never counts as a successful run.</p>
    </section>
    {!mobile && <CodingSeparator side="left" splits={splits} onPointerDown={event => startDrag("left", event)} onPointerMove={moveDrag} onPointerUp={endDrag} onKeyDown={event => resizeByKey("left", event)} />}
    <section className={`code-pane ${styles.editor}`} id="diagnostic-panel-code" {...panelProps("code")}>
      <div className="editor-toolbar"><span>main.py <small>Python</small></span><button className="text-button" onClick={() => setPlainEditor(!plainEditor)}>{plainEditor ? "Use code editor" : "Use plain text"}</button></div>
      <div className="editor-canvas">{plainEditor
        ? <textarea className="plain-editor" aria-label="Python code" value={code} spellCheck={false} onChange={event => studio.updateDiagnosticDraft({ code: event.target.value })} />
        : <Editor path={`diagnostic/${session.id}/${item.id}/main.py`} language="python" theme={monacoTheme} beforeMount={defineSnakepitThemes} value={code}
          onChange={value => studio.updateDiagnosticDraft({ code: value ?? "" })}
          loading={<p className="editor-loading">Loading code editor… You can also choose “Use plain text”.</p>}
          options={{ minimap: { enabled: false }, fontFamily: "IBM Plex Mono, monospace", fontSize: 13, lineHeight: 22, padding: { top: 16 }, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on", tabSize: 4, ariaLabel: "Python code editor. Press Escape then Tab to leave the editor.", accessibilitySupport: "on", fixedOverflowWidgets: true }} />}</div>
      {session.infraError && <div className="diagnostic-infra" role="alert">
        <p><strong>The Python run couldn’t complete.</strong> {session.infraError.message}</p>
        <p>Your code is preserved. Nothing was recorded for this question.</p>
        <button className="secondary" onClick={studio.runDiagnosticCode} disabled={studio.diagnosticBusy}>Retry run</button>
      </div>}
      {studio.diagnosticStale && <div className="diagnostic-infra" role="alert">
        <p><strong>The checker changed while you worked.</strong> Rerun to confirm your result.</p>
        <button className="secondary" onClick={() => studio.runDiagnosticCode()} disabled={studio.diagnosticBusy}>Run checks again</button>
      </div>}
      <div className="editor-actions">
        <button id="diagnostic-run-checks" className="primary" disabled={studio.diagnosticBusy} onClick={() => { studio.runDiagnosticCode(); if (mobile) selectPanel("checks"); }}>
          {studio.diagnosticBusy ? studio.diagnosticStatus : "Run checks"}<span aria-hidden="true"> ▷</span>
        </button>
        {studio.diagnosticBusy && <button className="secondary" onClick={studio.stopDiagnosticRun}>Stop run</button>}
        <button className={`secondary ${styles.unknownOption}`} onClick={studio.markDiagnosticUnknown} title="Record a knowledge gap. Any running check is cancelled and no result is graded.">{DIAGNOSTIC_UNKNOWN_ANSWER}</button>
        <span className="save-indicator" role="status">{studio.storageError ? "Not saved" : "Draft saved locally"}</span>
      </div>
    </section>
    {!mobile && <CodingSeparator side="right" splits={splits} onPointerDown={event => startDrag("right", event)} onPointerMove={moveDrag} onPointerUp={endDrag} onKeyDown={event => resizeByKey("right", event)} />}
    <aside className={`checks-wrap ${styles.checks}`} id="diagnostic-panel-checks" {...panelProps("checks")}>
      <CodingChecks studio={studio} />
    </aside>
  </div>;
}

function FinishPanel({ studio, session }: { studio: Studio; session: DiagnosticSession }) {
  const completion = canCompleteDiagnostic(session);
  if (completion.ok) return <section className="document" aria-label="Finish placement scan">
    <span className="eyebrow">SCAN COMPLETE</span>
    <h2>You’ve answered enough questions.</h2>
    <p>Finishing locks this session and produces your placement. You can take another scan any time.</p>
    <button className="primary" onClick={studio.finishDiagnostic}>See my placement →</button>
  </section>;
  const declarations = codingUnknownCount(session);
  const quotaBlocked = session.codingSuccessCount < DIAGNOSTIC_CODING_QUOTA && declarations < DIAGNOSTIC_CODING_QUOTA;
  return <section className="document" aria-label="Placement scan in progress">
    <span className="eyebrow">NOT QUITE FINISHED</span>
    <h2>{quotaBlocked
      ? `Answer ${DIAGNOSTIC_CODING_QUOTA} coding questions to continue.`
      : "A few more questions to go."}</h2>
    <ul>{completion.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    {quotaBlocked
      ? <p className="muted">Run working code or choose “{DIAGNOSTIC_UNKNOWN_ANSWER}” for each question. You have {plural(session.codingSuccessCount, "successful run")} and {plural(declarations, "unknown answer")}. Your code is saved.</p>
      : <p className="muted">Keep answering questions so every skill area gets a clear read before placement.</p>}
    <div className="button-row"><button className="secondary" onClick={studio.retakeDiagnostic}>Start a fresh scan</button></div>
  </section>;
}

function CompletedSession({ studio, session }: { studio: Studio; session: DiagnosticSession }) {
  const { profile, evidence } = deriveDiagnosticProfile(session);
  return <>
    <section className="document" aria-label="Placement scan results">
      <span className="eyebrow">PLACEMENT · {formatDate(session.completedAt ?? session.startedAt).toUpperCase()}</span>
      <h2>Your starting point</h2>
      <p>Here’s what your answers suggest so far.</p>
      <p className="muted">Your answers help choose a useful place to begin. You can change direction any time.</p>
      <div className="button-row">
        <button className="primary" onClick={() => studio.navigate("today")}>Start here · Home →</button>
        <button className="secondary" onClick={studio.retakeDiagnostic}>Retake scan</button>
      </div>
    </section>
    <section className="document"><div className="section-heading"><h2>Skill signals</h2></div>
      <ul className="skill-list">{DIAGNOSTIC_SKILLS.map(skill => <li key={skill.id}>
        <span>{skillTitle(skill.id)}</span>
        {(() => {
          const counts = evidence[skill.id];
          const total = counts.independent + counts.hinted + counts.wrong + counts.unknown;
          const rate = total ? (counts.independent + counts.hinted) / total : 0;
          const signal = profile[skill.id] === "untested" ? "Untested" : profile[skill.id] === "uncertain" ? "Uncertain" : rate >= 0.6 && counts.independent > 0 ? "Strong" : "Needs practice";
          const chip = signal === "Strong" ? "chip-lime" : signal === "Needs practice" ? "chip-magenta" : signal === "Uncertain" ? "chip-amber" : styles.untestedChip;
          return <span className={`chip ${chip}`}>{signal}</span>;
        })()}
      </li>)}</ul>
      <p className="muted">Placement is a starting point. Your skill tree tracks learning over time.</p>
    </section>
  </>;
}

function SessionHistory({ studio, currentId }: { studio: Studio; currentId: string }) {
  const sessions = studio.state.diagnosticSessions;
  if (sessions.length <= 1) return null;
  const latestId = sessions.at(-1)?.id;
  const statusLabel = (s: (typeof sessions)[number]) =>
    s.status === "completed" ? "Completed" : s.id === latestId ? "In progress" : "Superseded";
  return <section className="document"><div className="section-heading"><h2>Past sessions</h2></div>
    <ul className="skill-list">{[...sessions].reverse().map(s => <li key={s.id}>
      <span>{formatDate(s.startedAt)} · {s.responses.length} response{s.responses.length === 1 ? "" : "s"} · {s.codingSuccessCount} successful Python run{s.codingSuccessCount === 1 ? "" : "s"} · {statusLabel(s)}</span>
      {s.id === currentId
        ? <span className="status-label">Viewing</span>
        : <button className="text-button" onClick={() => studio.openDiagnosticSession(s.id)}>View →</button>}
    </li>)}</ul>
  </section>;
}

function DiagnosticBody({ studio }: { studio: Studio }) {
  const session = studio.state.diagnosticSessions.find(s => s.id === studio.route.diagnosticSessionId);
  if (!session) return <section className="document empty-state">
      <span className="eyebrow">PLACEMENT SCAN</span>
    <h2>This placement scan wasn’t found.</h2>
    <p>It may have been cleared with your browser data.</p>
    <div className="button-row">
      <button className="primary" onClick={studio.startDiagnostic}>Start a new placement scan</button>
      <button className="secondary" onClick={() => studio.navigate("today")}>Back to Home</button>
    </div>
  </section>;

  const latestId = studio.state.diagnosticSessions.at(-1)?.id;
  const interactive = session.status === "in-progress" && session.id === latestId;
  const currentItem = session.currentItemId ? DIAGNOSTIC_ITEMS.find(i => i.id === session.currentItemId) : undefined;
  return <>
    <div className="page-heading">
      <button className="text-button" onClick={() => studio.navigate("today")}>← Home</button>
      <h1 id="page-title" tabIndex={-1}>Placement scan</h1>
      <p>Answer a few questions to find a useful place to begin. Your results guide practice and never limit what you can try.</p>
    </div>
    <section className="document" aria-label="Placement scan progress">
      <div className="diagnostic-meta">
        <span className="chip chip-cyan">Q {Math.min(session.responses.length + 1, DIAGNOSTIC_MAX_ITEMS)}</span>
      </div>
      <ProgressBar answered={session.responses.length} />
      {session.status === "in-progress" && !interactive && <p className="muted">A newer session exists, so this one is read-only. Open the latest session to continue.</p>}
    </section>
    {session.status === "completed" && <CompletedSession studio={studio} session={session} />}
    {session.status === "in-progress" && interactive && (currentItem
      ? currentItem.kind === "concept"
        ? <ConceptItem key={`${session.id}:${currentItem.id}`} studio={studio} session={session} item={currentItem} />
        : <CodingItem key={currentItem.id} studio={studio} session={session} item={currentItem} />
      : <FinishPanel studio={studio} session={session} />)}
    {session.status === "in-progress" && !interactive && <section className="document empty-state">
      <h2>This session is superseded.</h2>
      <p>Start a fresh scan or return to your latest session.</p>
      <div className="button-row">
        <button className="primary" onClick={studio.retakeDiagnostic}>Start a fresh scan</button>
        <button className="secondary" onClick={() => latestId && studio.openDiagnosticSession(latestId)}>Open latest session</button>
      </div>
    </section>}
    <SessionHistory studio={studio} currentId={session.id} />
  </>;
}

export function DiagnosticStudio({ studio }: { studio: Studio }) {
  return <main id="main-content" className="dashboard"><DiagnosticBody studio={studio} /></main>;
}
