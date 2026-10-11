"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import Editor, { loader } from "@monaco-editor/react";
import styles from "./assessment-layout.module.css";
import type { Studio } from "./use-studio";
import { ASSESSMENTS, type Assessment, type AssessmentTask } from "../../curriculum/assessments";
import { getMission } from "../../lib/curriculum";
import { startGradingRun, type GradeResult } from "../../lib/runner";
import { gradeAssessmentWritten } from "../../lib/assessment-grading";
import { getAssessmentSkillStatus, recordAssessmentAttempt, type AssessmentTaskAttempt } from "../../lib/state";
import { defineSnakepitThemes, monacoThemeFor, useTheme } from "./theme";
import { graderCatalog } from "../../public/grading/catalog.js";
import { failureResult } from "../../public/grading/protocol.js";

loader.config({ paths: { vs: "/monaco/vs" } });

export type TaskDraft = {
  code: string;
  response: string;
  hintsUsed: number;
  aiAssisted: boolean;
  solutionViewed: boolean;
  gradeResult: GradeResult | null;
  writtenChecks: { id: string; passed: boolean; detail: string }[] | null;
  grading: boolean;
  saved: boolean;
};

/** A check result is evidence for the exact submitted source. Editing that
 * source invalidates the result and makes the draft unsaved again. */
export function updateAssessmentCodeDraft(draft: TaskDraft, code: string): TaskDraft {
  return { ...draft, code, gradeResult: null, grading: false, saved: false };
}

function emptyDraft(): TaskDraft {
  return {
    code: "",
    response: "",
    hintsUsed: 0,
    aiAssisted: false,
    solutionViewed: false,
    gradeResult: null,
    writtenChecks: null,
    grading: false,
    saved: false,
  };
}

/** Grading-run request for an assessment code task. Assignable to GradeRequest. */
export interface AssessmentRunRequest {
  type: "run";
  requestId: string;
  exerciseId: string;
  graderId: string;
  files: Record<string, string>;
}

/**
 * Build the grading-run request for an assessment code task. The exerciseId
 * comes from the registered grader-catalog entry for the task's graderId —
 * the grading worker rejects any run whose (exerciseId, graderId) pair is not
 * registered, so this never invents an id. Throws a descriptive error for an
 * unregistered graderId instead of sending a doomed run.
 */
export function buildAssessmentRunRequest(task: AssessmentTask, code: string): AssessmentRunRequest {
  const graderId = task.graderId ?? "";
  const registered = Object.entries(graderCatalog).find(([id]) => id === graderId)?.[1];
  if (!registered) {
    throw new Error(
      `Cannot grade assessment task "${task.id}": grader "${task.graderId ?? "missing"}" is not registered in the grader catalog — refusing to send a grading run with a guessed exerciseId.`,
    );
  }
  return {
    type: "run",
    requestId: crypto.randomUUID(),
    exerciseId: registered.exerciseId,
    graderId,
    files: { "main.py": code },
  };
}

function SkillChip({ studio, skillId }: { studio: Studio; skillId: string }) {
  const status = getAssessmentSkillStatus(studio.state, skillId);
  const label = status.status === "mastered" ? "Mastered" : status.status === "completed" ? "Completed" : "Not started";
  return <span className={`skill-chip status-${status.status}`}>{skillId}: {label}</span>;
}

/** Index-based arrow-key navigation for the assessment task tabs, mirroring
 *  nextWorkbenchPanel in lib/studio. Exported for unit tests. */
export function nextAssessmentTaskIndex(current: number, total: number, key: string): number {
  if (key === "Home") return 0;
  if (key === "End") return total - 1;
  const direction = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (direction === 0) return current;
  return (current + direction + total) % total;
}

/* --- Resizable three-pane assessment layout -------------------------------
 * The desktop task card splits into instructions | editor | feedback. Splits
 * are fractions of the row; the editor pane takes the remainder. The maths
 * mirrors workbench-resizer but lives here with its own storage key and pixel
 * floors so the two workbenches never fight over the same localStorage entry
 * or the same pane sizes. */

export interface AssessmentSplits { left: number; right: number }
export type AssessmentSplitSide = keyof AssessmentSplits;
export type AssessmentLayoutMode = "panes" | "stacked";

export const DEFAULT_ASSESSMENT_SPLITS: AssessmentSplits = { left: 0.26, right: 0.24 };
export const ASSESSMENT_SPLIT_STORAGE_KEY = "coding-school:assessment:splits";
/** Per-pane floors as fractions of the row; ASSESSMENT_MIN_PANE_PX mirrors the
 *  minmax() floors in assessment-layout.module.css so stored and rendered
 *  sizes agree. */
export const ASSESSMENT_MIN_FRACTION: Record<AssessmentSplitSide, number> = { left: 0.18, right: 0.18 };
export const ASSESSMENT_MIN_PANE_PX: Record<AssessmentSplitSide, number> = { left: 240, right: 240 };
/** Editor floor and separator width, mirroring the minmax(300px, 1fr) centre
 *  track and the two --as-sep tracks in assessment-layout.module.css. */
export const ASSESSMENT_EDITOR_MIN_PX = 300;
export const ASSESSMENT_SEP_PX = 12;
/** left + right never exceed this, so the editor pane keeps >= 38% of the row. */
export const ASSESSMENT_MAX_TOTAL = 0.62;
/** Narrowest row the three pixel floors can coexist in:
 *  240 + 12 + 300 + 12 + 240 = 804px. Below it there is no three-pane row to
 *  size — the layout stacks — so the pixel floors must not be applied there,
 *  or a floor could land above its own maximum and corrupt the splits. */
export const ASSESSMENT_ROW_FLOOR_PX =
  ASSESSMENT_MIN_PANE_PX.left + ASSESSMENT_SEP_PX + ASSESSMENT_EDITOR_MIN_PX + ASSESSMENT_SEP_PX + ASSESSMENT_MIN_PANE_PX.right;
/** Trim tolerance: keeps floating-point dust from counting as a violation. */
const SPLIT_EPSILON = 1e-12;
export const ASSESSMENT_KEY_STEP = 0.02;
export const ASSESSMENT_KEY_BIG_STEP = 0.1;
/** Three panes only once the dashboard column (viewport - 224px nav - 64px
 *  padding) can hold ASSESSMENT_ROW_FLOOR_PX: 804px, i.e. a 1120px viewport.
 *  Below this the layout stacks. The query is the single source of truth for
 *  the JS mode, and assessment-layout.module.css gates its grid on exactly the
 *  same string, so the two can never disagree. */
export const ASSESSMENT_PANES_MIN_WIDTH = 1120;
export const ASSESSMENT_PANES_QUERY = `(min-width: ${ASSESSMENT_PANES_MIN_WIDTH}px)`;

export function assessmentLayoutFor(panesQueryMatches: boolean): AssessmentLayoutMode {
  return panesQueryMatches ? "panes" : "stacked";
}

interface AssessmentSplitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function splitClamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function splitFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function otherSplitSide(side: AssessmentSplitSide): AssessmentSplitSide {
  return side === "left" ? "right" : "left";
}

/** Fraction floor for a pane: the larger of the authored fraction and the CSS
 *  pixel floor measured against the live row width. Rows narrower than
 *  ASSESSMENT_ROW_FLOOR_PX cannot hold the pixel floors at all (there is no
 *  three-pane row there), so only the authored fraction applies — otherwise a
 *  minimum would land above its own maximum and corrupt the splits. */
export function assessmentMinFraction(side: AssessmentSplitSide, containerWidth?: number): number {
  const base = ASSESSMENT_MIN_FRACTION[side];
  if (!containerWidth || containerWidth < ASSESSMENT_ROW_FLOOR_PX) return base;
  return Math.max(base, ASSESSMENT_MIN_PANE_PX[side] / containerWidth);
}

/**
 * Ceiling on left + right at a given row width. ASSESSMENT_MAX_TOTAL normally
 * binds, but on the narrowest rows the outer panes' 240px floors plus the
 * editor's 300px floor plus two 12px separators could otherwise sum past the
 * card: the grid's minmax() tracks would then overflow instead of shrinking.
 * So the cap also encodes "editor keeps >= 300px", which is exactly
 * (width - 2 * separator - editor floor) / width. The two rules agree whenever
 * the row is at least ~853px wide; below that the pixel rule binds instead.
 */
export function assessmentMaxTotal(containerWidth?: number): number {
  if (!containerWidth || containerWidth < ASSESSMENT_ROW_FLOOR_PX) return ASSESSMENT_MAX_TOTAL;
  const editorShare = (containerWidth - 2 * ASSESSMENT_SEP_PX - ASSESSMENT_EDITOR_MIN_PX) / containerWidth;
  return Math.min(ASSESSMENT_MAX_TOTAL, editorShare);
}

/** The most a pane may take: the total cap minus the other pane's floor — the
 *  point where the other pane sits exactly on its floor and has no spare width
 *  left to give. Width-aware, so the ceiling tightens with the pixel floors. */
export function assessmentMaxFraction(side: AssessmentSplitSide, containerWidth?: number): number {
  return assessmentMaxTotal(containerWidth) - assessmentMinFraction(otherSplitSide(side), containerWidth);
}

export function assessmentBoundsFor(side: AssessmentSplitSide, containerWidth?: number): { min: number; max: number } {
  return { min: assessmentMinFraction(side, containerWidth), max: assessmentMaxFraction(side, containerWidth) };
}

/**
 * Clamp a pair of splits into the valid region: both panes on or above their
 * floors, and left + right inside the total cap (which keeps the editor at or
 * above its own floor).
 *
 * When the pair is over the cap, room is given up from the OTHER pane first
 * (see `keep`). Trimming the pane the caller is moving would cancel the move —
 * the pair often already sums to the cap — freezing that separator in both
 * directions while the pane opposite it still held spare width. No `keep`
 * (observer / reload repair) trims left first, as before.
 */
export function clampAssessmentSplits(
  splits: AssessmentSplits,
  containerWidth?: number,
  keep?: AssessmentSplitSide,
): AssessmentSplits {
  const maxTotal = assessmentMaxTotal(containerWidth);
  const floor: Record<AssessmentSplitSide, number> = {
    left: assessmentMinFraction("left", containerWidth),
    right: assessmentMinFraction("right", containerWidth),
  };
  const value: Record<AssessmentSplitSide, number> = {
    left: splitClamp(
      splitFinite(splits.left, DEFAULT_ASSESSMENT_SPLITS.left),
      floor.left,
      Math.max(floor.left, assessmentMaxFraction("left", containerWidth)),
    ),
    right: splitClamp(
      splitFinite(splits.right, DEFAULT_ASSESSMENT_SPLITS.right),
      floor.right,
      Math.max(floor.right, assessmentMaxFraction("right", containerWidth)),
    ),
  };
  const over = value.left + value.right - maxTotal;
  if (over > SPLIT_EPSILON) {
    // The pane the caller is moving keeps the value it asked for; the other
    // pane absorbs the overflow down to its floor, and only then does the
    // moved pane give ground (which its own clamp above already prevents).
    const order: AssessmentSplitSide[] = keep === "left" ? ["right", "left"] : ["left", "right"];
    let remaining = over;
    for (const side of order) {
      const cut = Math.min(remaining, Math.max(0, value[side] - floor[side]));
      value[side] -= cut;
      remaining -= cut;
      if (remaining <= SPLIT_EPSILON) break;
    }
  }
  return { left: value.left, right: value.right };
}

/** Move one divider: the pane on `side` lands on exactly what was asked for,
 *  clamped to its own floor and ceiling; the other pane only moves to make
 *  room. Monotone in `value`, so a drag can never reverse or stall short of
 *  the ceiling while the other pane still has width to spare. */
export function setAssessmentSplit(
  splits: AssessmentSplits,
  side: AssessmentSplitSide,
  value: number,
  containerWidth?: number,
): AssessmentSplits {
  const next: AssessmentSplits = side === "left" ? { ...splits, left: value } : { ...splits, right: value };
  return clampAssessmentSplits(next, containerWidth, side);
}

export function nudgeAssessmentSplit(
  splits: AssessmentSplits,
  side: AssessmentSplitSide,
  delta: number,
  containerWidth?: number,
): AssessmentSplits {
  return setAssessmentSplit(splits, side, splitFinite(splits[side], 0) + delta, containerWidth);
}

export function parseAssessmentSplits(raw: string | null | undefined): AssessmentSplits | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { left, right } = parsed as Partial<AssessmentSplits>;
    if (typeof left !== "number" || typeof right !== "number") return null;
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    if (left <= 0 || left >= 1 || right <= 0 || right >= 1) return null;
    return { left, right };
  } catch {
    return null;
  }
}

export function serializeAssessmentSplits(splits: AssessmentSplits): string {
  const clamped = clampAssessmentSplits(splits);
  return JSON.stringify({ left: Number(clamped.left.toFixed(4)), right: Number(clamped.right.toFixed(4)) });
}

export function assessmentSplitStorage(): AssessmentSplitStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadAssessmentSplits(storage: AssessmentSplitStorage | null | undefined): AssessmentSplits {
  if (!storage) return { ...DEFAULT_ASSESSMENT_SPLITS };
  try {
    const stored = parseAssessmentSplits(storage.getItem(ASSESSMENT_SPLIT_STORAGE_KEY));
    return stored ? clampAssessmentSplits(stored) : { ...DEFAULT_ASSESSMENT_SPLITS };
  } catch {
    return { ...DEFAULT_ASSESSMENT_SPLITS };
  }
}

export function saveAssessmentSplits(storage: AssessmentSplitStorage | null | undefined, splits: AssessmentSplits): void {
  if (!storage) return;
  try {
    storage.setItem(ASSESSMENT_SPLIT_STORAGE_KEY, serializeAssessmentSplits(splits));
  } catch {
    /* private mode / quota: the layout still works, it just won't persist */
  }
}

/** Focusable splitter between two assessment panes: pointer drag on desktop,
 *  arrow keys from the keyboard (Shift = larger step, Home/End = extremes).
 *  Returns nothing in the stacked flow, where there is no divider to grab. */
function AssessmentPaneResizer({ layout, side, splits, onPointerDown, onPointerMove, onPointerUp, onKeyDown }: {
  layout: AssessmentLayoutMode;
  side: AssessmentSplitSide;
  splits: AssessmentSplits;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  if (layout !== "panes") return null;
  // Bounds are the width-independent ones: this markup is server-rendered
  // before any row width is measured. The live row tightens them through
  // assessmentBoundsFor(side, width), which is what Home/End jump to.
  const value = Math.round(splits[side] * 100);
  const min = Math.round(ASSESSMENT_MIN_FRACTION[side] * 100);
  const max = Math.round(assessmentMaxFraction(side) * 100);
  const panes = side === "left" ? ["instructions", "editor"] : ["editor", "feedback"];
  const paneName = side === "left" ? "Instructions" : "Feedback";
  return <div
    className={styles.separator}
    data-split={side}
    role="separator"
    aria-orientation="vertical"
    aria-label={`Resize ${panes[0]} and ${panes[1]} panes`}
    aria-controls={`assessment-pane-${panes[0]} assessment-pane-${panes[1]}`}
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

export function TaskRunner({ studio, assessment, task, draft, setDraft, layout: forcedLayout }: {
  studio: Studio;
  assessment: Assessment;
  task: AssessmentTask;
  draft: TaskDraft;
  setDraft: (update: (d: TaskDraft) => TaskDraft) => void;
  layout?: AssessmentLayoutMode;
}) {
  const runRef = useRef<{ cancel: () => void; requestId: string } | null>(null);
  const isCode = task.kind === "debug" || task.kind === "scratch" || task.kind === "project";
  const [plainEditor, setPlainEditor] = useState(false);
  const monacoTheme = monacoThemeFor(useTheme().theme);

  // Wide desktop gets three resizable panes; anything narrower stacks. The
  // query is byte-identical to the media gate in assessment-layout.module.css,
  // so the rendered separators and the grid can never disagree. SSR starts on
  // "panes" (where the CSS already shows them) and the client corrects it.
  const [detectedLayout, setDetectedLayout] = useState<AssessmentLayoutMode>("panes");
  useEffect(() => {
    const query = window.matchMedia(ASSESSMENT_PANES_QUERY);
    const sync = () => setDetectedLayout(assessmentLayoutFor(query.matches));
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const layout = forcedLayout ?? detectedLayout;

  // Desktop three-pane sizing. Defaults render first (SSR-safe), then the
  // stored proportions hydrate from localStorage and a ResizeObserver keeps
  // them inside their bounds when the window changes size.
  const [splits, setSplits] = useState<AssessmentSplits>(DEFAULT_ASSESSMENT_SPLITS);
  const splitsRef = useRef<AssessmentSplits>(DEFAULT_ASSESSMENT_SPLITS);
  const layoutRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ side: AssessmentSplitSide; startX: number; start: AssessmentSplits; width: number } | null>(null);
  function paneRowWidth(): number {
    const node = layoutRef.current;
    if (!node) return 0;
    // clientWidth is the padding box (borders excluded), which is what the
    // grid's percentage tracks resolve against — getBoundingClientRect would
    // include the card's 1px borders and let the fractions overshoot.
    return node.clientWidth || node.getBoundingClientRect().width;
  }
  function applySplits(next: AssessmentSplits, persist: boolean) {
    const width = paneRowWidth();
    const clamped = clampAssessmentSplits(next, width > 0 ? width : undefined);
    splitsRef.current = clamped;
    setSplits(clamped);
    if (persist) saveAssessmentSplits(assessmentSplitStorage(), clamped);
  }
  function startSplitDrag(side: AssessmentSplitSide, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const width = paneRowWidth();
    if (!width) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { side, startX: event.clientX, start: splitsRef.current, width };
    document.body.classList.add("as-dragging");
  }
  function moveSplitDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = (event.clientX - drag.startX) / drag.width;
    const value = drag.side === "left" ? drag.start.left + delta : drag.start.right - delta;
    applySplits(setAssessmentSplit(drag.start, drag.side, value, drag.width), false);
  }
  function endSplitDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.classList.remove("as-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    saveAssessmentSplits(assessmentSplitStorage(), splitsRef.current);
  }
  function resizeByKey(side: AssessmentSplitSide, event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const width = paneRowWidth();
    const boundsWidth = width > 0 ? width : undefined;
    const step = (event.shiftKey ? ASSESSMENT_KEY_BIG_STEP : ASSESSMENT_KEY_STEP) * (event.key === "ArrowRight" ? 1 : -1);
    const next = event.key === "Home" || event.key === "End"
      ? setAssessmentSplit(splitsRef.current, side, assessmentBoundsFor(side, boundsWidth)[event.key === "Home" ? "min" : "max"], boundsWidth)
      : nudgeAssessmentSplit(splitsRef.current, side, side === "left" ? step : -step, boundsWidth);
    applySplits(next, true);
  }
  useEffect(() => {
    const node = layoutRef.current;
    // Ask the query directly, not data-layout: this effect runs before the
    // first client render can correct the SSR "panes" default.
    const panes = window.matchMedia(ASSESSMENT_PANES_QUERY);
    const width = node?.clientWidth ?? 0;
    // A stacked card is phone-width: clamping the stored desktop split against
    // it would squash it. Take storage as-is there and let the observer clamp
    // once the card is wide enough to hold three panes again.
    const loaded = panes.matches
      ? clampAssessmentSplits(loadAssessmentSplits(assessmentSplitStorage()), width > 0 ? width : undefined)
      : loadAssessmentSplits(assessmentSplitStorage());
    splitsRef.current = loaded;
    setSplits(loaded);
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // Phone widths are not three-up: clamping against them would squash the
      // stored desktop split. Read the query, not data-layout — a resize can
      // reach the observer before React has re-rendered the new mode.
      if (!panes.matches) return;
      const observed = node.clientWidth || node.getBoundingClientRect().width;
      if (observed <= 0) return;
      setSplits(current => {
        const next = clampAssessmentSplits(current, observed);
        splitsRef.current = next;
        return next;
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function updateCode(code: string) {
    runRef.current?.cancel();
    runRef.current = null;
    setDraft(d => updateAssessmentCodeDraft(d, code));
  }

  function runCodeChecks() {
    if (runRef.current) runRef.current.cancel();
    let request: AssessmentRunRequest;
    try {
      request = buildAssessmentRunRequest(task, draft.code);
    } catch (error) {
      // Fail closed: no registered grader, no run. Show the reason through
      // the existing check-results UI instead of crashing the component.
      const message = error instanceof Error ? error.message : String(error);
      setDraft(d => ({
        ...d,
        grading: false,
        gradeResult: failureResult(
          { requestId: crypto.randomUUID(), exerciseId: task.graderId ?? "", graderId: task.graderId ?? "" },
          message,
        ),
      }));
      return;
    }
    const requestId = request.requestId;
    setDraft(d => ({ ...d, grading: true, gradeResult: null }));
    const cancel = startGradingRun(
      request,
      result => {
        runRef.current = null;
        setDraft(d => ({ ...d, grading: false, gradeResult: result }));
      },
      undefined,
      15000,
      undefined,
    );
    runRef.current = { cancel, requestId };
  }

  function gradeWritten() {
    const raw = gradeAssessmentWritten(task.exerciseId!, draft.response);
    setDraft(d => ({
      ...d,
      writtenChecks: raw.tests.map(t => ({ id: t.id, passed: t.passed, detail: t.detail })),
    }));
  }

  function revealHint() {
    setDraft(d => ({ ...d, hintsUsed: Math.min(d.hintsUsed + 1, task.hints.length) }));
  }

  function saveResult() {
    const passed = isCode
      ? Boolean(draft.gradeResult?.passed)
      : Boolean(draft.writtenChecks?.length && draft.writtenChecks.every(c => c.passed));
    const attempt: AssessmentTaskAttempt = {
      attemptId: crypto.randomUUID(),
      taskId: task.id,
      assessmentId: assessment.id,
      skillId: task.skillId,
      result: {
        passed,
        hintsUsed: draft.hintsUsed,
        aiAssisted: draft.aiAssisted,
        solutionViewed: draft.solutionViewed,
      },
      completedAt: new Date().toISOString(),
    };
    studio.applyState(state => recordAssessmentAttempt(state, attempt));
    setDraft(d => ({ ...d, saved: true }));
  }

  const canSave = isCode ? draft.gradeResult !== null : draft.writtenChecks !== null;
  const assistanceNote = draft.hintsUsed > 0 || draft.aiAssisted || draft.solutionViewed
    ? "Assisted — this attempt records as practice, not independent mastery."
    : "Independent so far — no hints, AI, or solutions recorded.";

  return <div
    className={`assessment-task ${styles.task}`}
    data-layout={layout}
    ref={layoutRef}
    style={{ "--as-left": `${(splits.left * 100).toFixed(3)}%`, "--as-right": `${(splits.right * 100).toFixed(3)}%` } as CSSProperties}
  >
    <div className={styles.pane} id="assessment-pane-instructions">
      <span className="eyebrow">{task.kind.toUpperCase()} · {task.skillId}</span>
      <h2>{task.title}</h2>
      <pre className="assessment-prompt">{task.prompt}</pre>

      <section className="assessment-rubric">
        <h3>Rubric</h3>
        <ul>{task.rubric.map(criterion => <li key={criterion}>{criterion}</li>)}</ul>
      </section>

      <section className="hint-section">
        <div className="section-heading"><h3>Need a nudge?</h3><span className="muted">{draft.hintsUsed}/{task.hints.length} hints</span></div>
        <p className="muted">Reveal one hint at a time. Every hint is saved with your attempt — four or more weakens a full level.</p>
        {task.hints.slice(0, draft.hintsUsed).map((hint, i) => <p className="hint" key={i}><strong>Hint {i + 1}</strong> {hint}</p>)}
        {draft.hintsUsed < task.hints.length && <button className="secondary" onClick={revealHint}>Reveal hint {draft.hintsUsed + 1}</button>}
        <details className="assistance-disclosure">
          <summary>Record other help</summary>
          <p className="muted">If you used help outside this app, record it — assisted success is practice, not mastery.</p>
          <label><input type="checkbox" checked={draft.aiAssisted} onChange={() => setDraft(d => ({ ...d, aiAssisted: true, saved: false }))} /> I used external AI assistance</label>
          <label><input type="checkbox" checked={draft.solutionViewed} onChange={() => setDraft(d => ({ ...d, solutionViewed: true, saved: false }))} /> I viewed a solution</label>
        </details>
        <p className="muted">{assistanceNote}</p>
      </section>
    </div>

    <AssessmentPaneResizer
      layout={layout}
      side="left"
      splits={splits}
      onPointerDown={event => startSplitDrag("left", event)}
      onPointerMove={moveSplitDrag}
      onPointerUp={endSplitDrag}
      onKeyDown={event => resizeByKey("left", event)}
    />

    <div className={styles.pane} id="assessment-pane-editor">
      {isCode ? <>
        <div className="editor-toolbar"><span>main.py <small>Python</small></span><button className="text-button" onClick={() => setPlainEditor(!plainEditor)}>{plainEditor ? "Use code editor" : "Use plain text"}</button></div>
        <div className="editor-canvas assessment-editor">{plainEditor
          ? <textarea className="plain-editor" aria-label="Python code" value={draft.code} spellCheck={false} onChange={event => updateCode(event.target.value)} />
          : <Editor
            path={`assessment/${assessment.id}/${task.id}/main.py`}
            language="python"
            theme={monacoTheme}
            beforeMount={defineSnakepitThemes}
            value={draft.code}
            onChange={value => updateCode(value ?? "")}
            loading={<p className="editor-loading">Loading code editor… You can also choose “Use plain text”.</p>}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineHeight: 22,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: "on",
              tabSize: 4,
            }}
          />}</div>
        <div className="editor-actions">
          <button className="primary" disabled={draft.grading} onClick={runCodeChecks}>
            {draft.grading ? "Running…" : "Run checks"}<span aria-hidden="true"> ▷</span>
          </button>
        </div>
      </> : <>
        <label className={styles.fieldLabel} htmlFor={`response-${task.id}`}>Your answer</label>
        <textarea
          id={`response-${task.id}`}
          className="assessment-response"
          rows={8}
          value={draft.response}
          onChange={event => setDraft(d => ({ ...d, response: event.target.value, saved: false, writtenChecks: null }))}
          placeholder="Answer in your own words. Be specific."
        />
        <div className="editor-actions">
          <button className="primary" onClick={gradeWritten}>Grade answer</button>
        </div>
      </>}
    </div>

    <AssessmentPaneResizer
      layout={layout}
      side="right"
      splits={splits}
      onPointerDown={event => startSplitDrag("right", event)}
      onPointerMove={moveSplitDrag}
      onPointerUp={endSplitDrag}
      onKeyDown={event => resizeByKey("right", event)}
    />

    <div className={styles.pane} id="assessment-pane-feedback">
      <h3 className={styles.paneHeading}>{isCode ? "Checks & output" : "Feedback"}</h3>
      {isCode ? <>
        {draft.grading && <p className="muted">Running your checks…</p>}
        {!draft.grading && !draft.gradeResult && <p className="muted">Run your code to see its checks, standard output, and standard error here.</p>}
        {draft.gradeResult && <ul className="check-results">
          {draft.gradeResult.tests.map(check => <li key={check.id} className={check.passed ? "check-pass" : "check-fail"}>
            <span aria-hidden="true">{check.passed ? "✓" : "×"}</span>
            <div><strong><span className="visually-hidden">{check.passed ? "Passed" : "Failed"}: </span>{check.name}</strong>{check.detail && <p>{check.detail}</p>}</div>
          </li>)}
        </ul>}
        {draft.gradeResult && <>
          <div className={`console-output ${styles.console}`}>
            <h4 className={styles.consoleHeading}>Standard output</h4>
            <pre>{draft.gradeResult.stdout || "No standard output."}</pre>
          </div>
          <div className={`console-errors ${styles.console}`}>
            <h4 className={`${styles.consoleHeading}${draft.gradeResult.stderr ? ` ${styles.consoleHeadingError}` : ""}`}>
              Standard error{draft.gradeResult.stderr ? " · has error output" : ""}
            </h4>
            <pre>{draft.gradeResult.stderr || "No standard error."}</pre>
          </div>
        </>}
      </> : <>
        {!draft.writtenChecks && <p className="muted">Grade your answer to see feedback here.</p>}
        {draft.writtenChecks && <ul className="check-results">
          {draft.writtenChecks.map(check => <li key={check.id} className={check.passed ? "check-pass" : "check-fail"}>
            <span aria-hidden="true">{check.passed ? "✓" : "×"}</span>
            <div><strong><span className="visually-hidden">{check.passed ? "Passed" : "Failed"}: </span>{check.id}</strong><p>{check.detail}</p></div>
          </li>)}
        </ul>}
      </>}

      <footer className="assessment-save">
        <button className="primary" disabled={!canSave || draft.saved} onClick={saveResult}>
          {draft.saved ? "Saved ✓" : "Save task result"}
        </button>
        {!canSave && <span className="muted">Run the checks or grade your answer before saving.</span>}
      </footer>
    </div>
  </div>;
}

export function AssessmentDetail({ studio, assessment, onBack }: { studio: Studio; assessment: Assessment; onBack: () => void }) {
  const [taskIndex, setTaskIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The "Start checkpoint" button unmounts with the hub: move focus to the
  // detail heading so keyboard and screen-reader users land on the new view
  // instead of having focus dropped to <body>.
  useEffect(() => { headingRef.current?.focus(); }, []);
  const task = assessment.tasks[taskIndex];
  const draft = drafts[task.id] ?? emptyDraft();
  const setDraft = (update: (d: TaskDraft) => TaskDraft) =>
    setDrafts(prev => ({ ...prev, [task.id]: update(prev[task.id] ?? emptyDraft()) }));

  const savedCount = assessment.tasks.filter(t => {
    const attempt = studio.state.assessmentAttempts.filter(a => a.taskId === t.id).at(-1);
    return Boolean(attempt);
  }).length;

  return <section className={`assessment-detail ${styles.detail}`} aria-label="Checkpoint assessment">
    <button className="text-button" onClick={onBack}>← All checkpoints</button>
    <span className="eyebrow">CHECKPOINT ASSESSMENT</span>
    <h1 ref={headingRef} tabIndex={-1}>{assessment.title}</h1>
    <p>{assessment.description}</p>
    <p className="muted">{savedCount} of {assessment.tasks.length} tasks saved.</p>

    <div className="assessment-tabs" role="tablist" aria-label="Assessment tasks">
      {assessment.tasks.map((t, i) => {
        const attempt = studio.state.assessmentAttempts.filter(a => a.taskId === t.id).at(-1);
        const selected = i === taskIndex;
        const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const next = nextAssessmentTaskIndex(taskIndex, assessment.tasks.length, event.key);
            setTaskIndex(next);
            document.getElementById(`assessment-tab-${assessment.tasks[next].id}`)?.focus();
          }
        };
        return <button
          key={t.id}
          role="tab"
          id={`assessment-tab-${t.id}`}
          aria-controls={`assessment-panel-${t.id}`}
          aria-selected={selected}
          tabIndex={selected ? 0 : -1}
          className={selected ? "active" : ""}
          onClick={() => setTaskIndex(i)}
          onKeyDown={onKeyDown}
        >
          {t.kind}{attempt ? (attempt.mastered ? " ✓" : " ·") : ""}
        </button>;
      })}
    </div>

    <div role="tabpanel" id={`assessment-panel-${task.id}`} aria-labelledby={`assessment-tab-${task.id}`}>
      <TaskRunner studio={studio} assessment={assessment} task={task} draft={draft} setDraft={setDraft} />
    </div>

    <section className="assessment-evidence">
      <h3>Evidence for {task.skillId}</h3>
      {(() => {
        const status = getAssessmentSkillStatus(studio.state, task.skillId);
        const attempts = studio.state.assessmentAttempts.filter(a => a.skillId === task.skillId);
        return <>
          <p>Status: <strong>{status.status}</strong> · {status.independentTasks} independent task(s) across {status.completedTasks} completed.</p>
          {attempts.length > 0 && <ul>
            {attempts.map(a => <li key={a.attemptId}>
              {a.taskId}: {a.mastered ? "mastered" : a.passed ? "passed (assisted)" : "needs work"}
              {a.hintsUsed > 0 && ` · ${a.hintsUsed} hint(s)`}
              {a.aiAssisted && " · AI-assisted"}
              {a.solutionViewed && " · solution viewed"}
            </li>)}
          </ul>}
          {status.status === "mastered" && <p className="success-note">Mastered: independent work in more than one context and date.</p>}
        </>;
      })()}
    </section>
  </section>;
}

/** "Sep 13, 2026" — local, display-only formatting for a saved ISO timestamp. */
function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Self-review of the learner's actual saved mission work: the build project's
 * named check outcomes and the written reflection, exactly as recorded. This
 * is a review of saved records — never a new assessment or a mastery claim.
 */
function MissionSelfReview({ studio }: { studio: Studio }) {
  const completedRuns = studio.state.missionRuns
    .filter(run => run.status === "completed" && run.mode === "mission")
    .sort((a, b) => String(b.completedAt ?? "").localeCompare(String(a.completedAt ?? "")));

  return <section className="assessment-self-review" aria-label="Mission self-review">
    <h2>Mission self-review</h2>
    <p className="muted">Your saved mission work, exactly as you left it: the build project&apos;s check results and your written reflection. This is a self-review of your own records — not a new assessment and not a mastery claim.</p>
    {completedRuns.length === 0 ? (
      <p>Complete a mission and its project checks and reflection will appear here for self-review.</p>
    ) : (
      <ul className="self-review-runs">
        {completedRuns.map(run => {
          const runAttempts = studio.state.attempts.filter(a => a.runId === run.id);
          const project = runAttempts.filter(a => a.purpose === "project").at(-1);
          const reflection = runAttempts.filter(a => a.purpose === "reflection").at(-1);
          const reflectionText = reflection?.response.trim() ?? "";
          return <li key={run.id} className="self-review-run">
            <h3>{getMission(run.missionId)?.title ?? run.missionId}</h3>
            <p className="muted">Completed {run.completedAt ? formatShortDate(run.completedAt) : "date unknown"}.</p>
            <h4>Project checks</h4>
            {project && project.checks.length > 0 ? (
              <ul className="check-results">
                {project.checks.map(check => <li key={check.id} className={check.passed ? "check-pass" : "check-fail"}>
                  <span aria-hidden="true">{check.passed ? "✓" : "×"}</span>
                  <div><strong>{check.name}</strong>: {check.passed ? "passed" : "failed"}</div>
                </li>)}
              </ul>
            ) : (
              <p className="muted">No project checks recorded for this mission.</p>
            )}
            <h4>Reflection</h4>
            {reflectionText ? (
              reflectionText.length > 600 ? <>
                <p>{reflectionText.slice(0, 600)}…</p>
                <details>
                  <summary>Read the full reflection</summary>
                  <p>{reflectionText}</p>
                </details>
              </> : <p>{reflectionText}</p>
            ) : (
              <p className="muted">No reflection saved.</p>
            )}
          </li>;
        })}
      </ul>
    )}
  </section>;
}

export function AssessmentWorkbench({ studio }: { studio: Studio }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const assessment = ASSESSMENTS.find(a => a.id === selectedId);
  const hubHeadingRef = useRef<HTMLHeadingElement>(null);
  const wasDetailOpen = useRef(false);
  // The detail view unmounts on "← All checkpoints": move focus back to the
  // hub heading so it isn't dropped to <body>.
  useEffect(() => {
    if (wasDetailOpen.current && !assessment) hubHeadingRef.current?.focus();
    wasDetailOpen.current = Boolean(assessment);
  }, [assessment]);

  if (assessment) {
    return <AssessmentDetail studio={studio} assessment={assessment} onBack={() => setSelectedId(null)} />;
  }

  return <section className="assessment-hub" aria-label="Checkpoint assessments">
    <span className="eyebrow">CHECKPOINT ASSESSMENTS</span>
    <h1 ref={hubHeadingRef} tabIndex={-1}>Prove it in a new context.</h1>
    <p>Each checkpoint re-tests the mission skills with fresh scenarios: read code, debug planted bugs, write from scratch, build a small project, and explain your reasoning. No solutions are shown — hints, AI use, and solution views are all recorded.</p>
    <div className="assessment-cards">
      {ASSESSMENTS.map(a => <article key={a.id} className="assessment-card">
        <h2>{a.title}</h2>
        <p>{a.description}</p>
        <div className="skill-chips">
          {[...new Set(a.tasks.map(t => t.skillId))].map(skillId => <SkillChip key={skillId} studio={studio} skillId={skillId} />)}
        </div>
        <button className="primary" onClick={() => setSelectedId(a.id)}>Start checkpoint →</button>
      </article>)}
    </div>
    <MissionSelfReview studio={studio} />
    <section className="assessment-mastery">
      <h2>Cross-checkpoint mastery</h2>
      <p className="muted">A skill is <strong>completed</strong> with one task attempt and <strong>mastered</strong> with independent work in more than one context and date. Assisted success is practice, never mastery.</p>
      <ul>
        {["code-reading", "debugging", "scratch-coding", "project-building", "design-explanation"].map(skillId => {
          const status = getAssessmentSkillStatus(studio.state, skillId);
          return <li key={skillId}><strong>{skillId}</strong>: {status.status} ({status.independentTasks} independent / {status.completedTasks} completed)</li>;
        })}
      </ul>
    </section>
  </section>;
}
