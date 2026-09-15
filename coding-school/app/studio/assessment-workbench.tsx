"use client";

import { useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import type { Studio } from "./use-studio";
import { ASSESSMENTS, type Assessment, type AssessmentTask } from "../../curriculum/assessments";
import { getMission } from "../../lib/curriculum";
import { startGradingRun, type GradeResult } from "../../lib/runner";
import { gradeAssessmentWritten } from "../../lib/assessment-grading";
import { getAssessmentSkillStatus, recordAssessmentAttempt, type AssessmentTaskAttempt } from "../../lib/state";

loader.config({ paths: { vs: "/monaco/vs" } });

type TaskDraft = {
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

function SkillChip({ studio, skillId }: { studio: Studio; skillId: string }) {
  const status = getAssessmentSkillStatus(studio.state, skillId);
  const label = status.status === "mastered" ? "Mastered" : status.status === "completed" ? "Completed" : "Not started";
  return <span className={`skill-chip status-${status.status}`}>{skillId}: {label}</span>;
}

function TaskRunner({ studio, assessment, task, draft, setDraft }: {
  studio: Studio;
  assessment: Assessment;
  task: AssessmentTask;
  draft: TaskDraft;
  setDraft: (update: (d: TaskDraft) => TaskDraft) => void;
}) {
  const runRef = useRef<{ cancel: () => void; requestId: string } | null>(null);
  const isCode = task.kind === "debug" || task.kind === "scratch" || task.kind === "project";

  function runCodeChecks() {
    const requestId = crypto.randomUUID();
    if (runRef.current) runRef.current.cancel();
    setDraft(d => ({ ...d, grading: true, gradeResult: null }));
    const cancel = startGradingRun(
      {
        type: "run",
        requestId,
        exerciseId: `${task.id}-exercise`,
        graderId: task.graderId!,
        files: { "main.py": draft.code },
      },
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

  return <div className="assessment-task">
    <span className="eyebrow">{task.kind.toUpperCase()} · {task.skillId}</span>
    <h2>{task.title}</h2>
    <pre className="assessment-prompt">{task.prompt}</pre>

    <section className="assessment-rubric">
      <h3>Rubric</h3>
      <ul>{task.rubric.map(criterion => <li key={criterion}>{criterion}</li>)}</ul>
    </section>

    {isCode ? <>
      <div className="editor-toolbar"><span>main.py <small>Python</small></span></div>
      <div className="editor-canvas assessment-editor">
        <Editor
          path={`assessment/${assessment.id}/${task.id}/main.py`}
          language="python"
          theme="light"
          value={draft.code}
          onChange={value => setDraft(d => ({ ...d, code: value ?? "", saved: false }))}
          loading={<p className="editor-loading">Loading code editor…</p>}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineHeight: 22,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: "on",
            tabSize: 4,
          }}
        />
      </div>
      <div className="editor-actions">
        <button className="primary" disabled={draft.grading} onClick={runCodeChecks}>
          {draft.grading ? "Running…" : "Run checks"}<span aria-hidden="true"> ▷</span>
        </button>
      </div>
      {draft.gradeResult && <ul className="check-results">
        {draft.gradeResult.tests.map(check => <li key={check.id} className={check.passed ? "check-pass" : "check-fail"}>
          <span aria-hidden="true">{check.passed ? "✓" : "×"}</span>
          <div><strong>{check.name}</strong>{check.detail && <p>{check.detail}</p>}</div>
        </li>)}
      </ul>}
    </> : <>
      <label htmlFor={`response-${task.id}`}>Your answer</label>
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
      {draft.writtenChecks && <ul className="check-results">
        {draft.writtenChecks.map(check => <li key={check.id} className={check.passed ? "check-pass" : "check-fail"}>
          <span aria-hidden="true">{check.passed ? "✓" : "×"}</span>
          <div><strong>{check.id}</strong><p>{check.detail}</p></div>
        </li>)}
      </ul>}
    </>}

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

    <footer className="assessment-save">
      <button className="primary" disabled={!canSave || draft.saved} onClick={saveResult}>
        {draft.saved ? "Saved ✓" : "Save task result"}
      </button>
      {!canSave && <span className="muted">Run the checks or grade your answer before saving.</span>}
    </footer>
  </div>;
}

function AssessmentDetail({ studio, assessment, onBack }: { studio: Studio; assessment: Assessment; onBack: () => void }) {
  const [taskIndex, setTaskIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({});
  const task = assessment.tasks[taskIndex];
  const draft = drafts[task.id] ?? emptyDraft();
  const setDraft = (update: (d: TaskDraft) => TaskDraft) =>
    setDrafts(prev => ({ ...prev, [task.id]: update(prev[task.id] ?? emptyDraft()) }));

  const savedCount = assessment.tasks.filter(t => {
    const attempt = studio.state.assessmentAttempts.filter(a => a.taskId === t.id).at(-1);
    return Boolean(attempt);
  }).length;

  return <section className="assessment-detail" aria-label="Checkpoint assessment">
    <button className="text-button" onClick={onBack}>← All checkpoints</button>
    <span className="eyebrow">CHECKPOINT ASSESSMENT</span>
    <h1>{assessment.title}</h1>
    <p>{assessment.description}</p>
    <p className="muted">{savedCount} of {assessment.tasks.length} tasks saved.</p>

    <div className="assessment-tabs" role="tablist" aria-label="Assessment tasks">
      {assessment.tasks.map((t, i) => {
        const attempt = studio.state.assessmentAttempts.filter(a => a.taskId === t.id).at(-1);
        return <button
          key={t.id}
          role="tab"
          aria-selected={i === taskIndex}
          className={i === taskIndex ? "active" : ""}
          onClick={() => setTaskIndex(i)}
        >
          {t.kind}{attempt ? (attempt.mastered ? " ✓" : " ·") : ""}
        </button>;
      })}
    </div>

    <TaskRunner studio={studio} assessment={assessment} task={task} draft={draft} setDraft={setDraft} />

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

  if (assessment) {
    return <AssessmentDetail studio={studio} assessment={assessment} onBack={() => setSelectedId(null)} />;
  }

  return <section className="assessment-hub" aria-label="Checkpoint assessments">
    <span className="eyebrow">CHECKPOINT ASSESSMENTS</span>
    <h1>Prove it in a new context.</h1>
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
