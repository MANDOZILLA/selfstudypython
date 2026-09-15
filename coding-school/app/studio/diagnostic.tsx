"use client";
import Editor, { loader } from "@monaco-editor/react";
import { useState } from "react";
import type { Studio } from "./use-studio";
import { DIAGNOSTIC_ITEMS, DIAGNOSTIC_SKILLS, type DiagnosticItem } from "../../curriculum";
import {
  DIAGNOSTIC_CODING_QUOTA,
  DIAGNOSTIC_MAX_ITEMS,
  canCompleteDiagnostic,
  deriveDiagnosticProfile,
  type DiagnosticSession,
} from "../../lib/diagnostic";

loader.config({ paths: { vs: "/monaco/vs" } });

const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const skillTitle = (skillId: string) => DIAGNOSTIC_SKILLS.find(s => s.id === skillId)?.title ?? skillId;
const profileLabel: Record<string, string> = { observed: "Observed", uncertain: "Uncertain", untested: "Untested" };

function ProgressBar({ answered }: { answered: number }) {
  return <div className="diagnostic-progress" role="progressbar" aria-valuenow={answered} aria-valuemin={0} aria-valuemax={DIAGNOSTIC_MAX_ITEMS} aria-label="Diagnostic progress">
    <span style={{ width: `${Math.min(100, (answered / DIAGNOSTIC_MAX_ITEMS) * 100)}%` }} />
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

function ConceptItem({ studio, session, item }: { studio: Studio; session: DiagnosticSession; item: DiagnosticItem }) {
  return <section className="document" aria-label="Diagnostic question">
    <span className="eyebrow">QUESTION {session.responses.length + 1} · {skillTitle(item.skillId).toUpperCase()}</span>
    <p className="diagnostic-prompt">{item.prompt}</p>
    <Hints item={item} revealed={session.draftHints} onReveal={studio.revealDiagnosticHint} />
    <label className="diagnostic-answer-label" htmlFor="diagnostic-answer">Your answer</label>
    <textarea id="diagnostic-answer" className="diagnostic-answer" rows={4} value={session.draftAnswer}
      onChange={event => studio.updateDiagnosticDraft({ answer: event.target.value })}
      placeholder="Explain in your own words…" />
    <div className="button-row">
      <button className="primary" onClick={studio.answerDiagnosticConcept} disabled={!session.draftAnswer.trim()}>Submit answer →</button>
    </div>
    <p className="muted">Your answer is saved as you type. It never affects your grade — it only calibrates your starting point.</p>
  </section>;
}

function CodingChecks({ studio }: { studio: Studio }) {
  const result = studio.diagnosticResult;
  if (!result) return null;
  return <div className="checks-panel" role="status">
    <h3>{studio.diagnosticStatus}</h3>
    <ul className="check-results">
      {result.tests.map(test => <li key={test.id} className={test.passed ? "check-pass" : "check-fail"}>
        <strong>{test.passed ? "Passed" : "Needs changes"}:</strong> {test.name}
        {test.detail && <p>{test.detail}</p>}
      </li>)}
    </ul>
    {(result.stdout || result.stderr) && <details><summary>Console output</summary><pre className="console-output">{[result.stdout, result.stderr].filter(Boolean).join("\n")}</pre></details>}
  </div>;
}

function CodingItem({ studio, session, item }: { studio: Studio; session: DiagnosticSession; item: DiagnosticItem }) {
  const [plainEditor, setPlainEditor] = useState(false);
  const coding = item.coding!;
  const code = session.draftCode.trim() ? session.draftCode : coding.starterCode;
  return <section className="document" aria-label="Diagnostic coding question">
    <span className="eyebrow">QUESTION {session.responses.length + 1} · {skillTitle(item.skillId).toUpperCase()}</span>
    <p className="diagnostic-prompt">{item.prompt}</p>
    <Hints item={item} revealed={session.draftHints} onReveal={studio.revealDiagnosticHint} />
    <div className="editor-toolbar"><span>main.py <small>Python</small></span><button className="text-button" onClick={() => setPlainEditor(!plainEditor)}>{plainEditor ? "Use code editor" : "Use plain text"}</button></div>
    <div className="editor-canvas">{plainEditor
      ? <textarea className="plain-editor" aria-label="Python code" value={code} spellCheck={false} onChange={event => studio.updateDiagnosticDraft({ code: event.target.value })} />
      : <Editor path={`diagnostic/${session.id}/${item.id}/main.py`} language="python" theme="light" value={code}
        onChange={value => studio.updateDiagnosticDraft({ code: value ?? "" })}
        loading={<p className="editor-loading">Loading code editor… You can also choose “Use plain text”.</p>}
        options={{ minimap: { enabled: false }, fontFamily: "IBM Plex Mono, monospace", fontSize: 13, lineHeight: 22, padding: { top: 16 }, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on", tabSize: 4, ariaLabel: "Python code editor. Press Escape then Tab to leave the editor.", accessibilitySupport: "on", fixedOverflowWidgets: true }} />}</div>
    {session.infraError && <div className="diagnostic-infra" role="alert">
      <p><strong>The Python run couldn’t complete.</strong> {session.infraError.message}</p>
      <p>Your code is preserved. Nothing was recorded for this question.</p>
      <button className="secondary" onClick={studio.runDiagnosticCode} disabled={studio.diagnosticBusy}>Retry run</button>
    </div>}
    {studio.diagnosticStale && <div className="diagnostic-infra" role="alert">
      <p><strong>The grader was updated while you worked.</strong> Nothing was recorded — run the checks again.</p>
      <button className="secondary" onClick={() => studio.runDiagnosticCode()} disabled={studio.diagnosticBusy}>Run checks again</button>
    </div>}
    <div className="editor-actions">
      <button id="diagnostic-run-checks" className="primary" disabled={studio.diagnosticBusy} onClick={studio.runDiagnosticCode}>
        {studio.diagnosticBusy ? studio.diagnosticStatus : "Run checks"}<span aria-hidden="true"> ▷</span>
      </button>
      {studio.diagnosticBusy && <button className="secondary" onClick={studio.stopDiagnosticRun}>Stop run</button>}
      <span className="save-indicator" role="status">{studio.storageError ? "Not saved" : "Draft saved locally"}</span>
    </div>
    <CodingChecks studio={studio} />
  </section>;
}

function FinishPanel({ studio, session }: { studio: Studio; session: DiagnosticSession }) {
  const completion = canCompleteDiagnostic(session);
  if (completion.ok) return <section className="document" aria-label="Finish diagnostic">
    <span className="eyebrow">DIAGNOSTIC COMPLETE</span>
    <h2>You’ve answered enough questions.</h2>
    <p>Finishing locks this session and produces your placement. You can retake it any time; retakes start a fresh session.</p>
    <button className="primary" onClick={studio.finishDiagnostic}>See my placement →</button>
  </section>;
  const quotaBlocked = session.codingSuccessCount < DIAGNOSTIC_CODING_QUOTA;
  return <section className="document" aria-label="Diagnostic blocked">
    <span className="eyebrow">NOT QUITE FINISHED</span>
    <h2>{quotaBlocked
      ? `${DIAGNOSTIC_CODING_QUOTA} successful Python runs are required.`
      : "A few more questions to go."}</h2>
    <ul>{completion.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    {quotaBlocked
      ? <p className="muted">Each coding question needs its checks to pass with a working Python run. Your code is preserved — keep going.</p>
      : <p className="muted">Keep answering questions so every skill area gets a clear read before placement.</p>}
    <div className="button-row"><button className="secondary" onClick={studio.retakeDiagnostic}>Start a fresh retake</button></div>
  </section>;
}

function CompletedSession({ studio, session }: { studio: Studio; session: DiagnosticSession }) {
  const { profile, recommendation, legacyCount } = deriveDiagnosticProfile(session);
  return <>
    <section className="document" aria-label="Diagnostic placement">
      <span className="eyebrow">PLACEMENT · {formatDate(session.completedAt ?? session.startedAt).toUpperCase()}</span>
      <h2>Your starting point</h2>
      <p>{recommendation}</p>
      {legacyCount > 0 && <p className="muted"><strong>Legacy / unverified:</strong> {legacyCount} response{legacyCount === 1 ? " was" : "s were"} graded with an older version and did not affect placement.</p>}
      <div className="button-row">
        <button className="primary" onClick={studio.retakeDiagnostic}>Retake diagnostic</button>
        <button className="secondary" onClick={() => studio.navigate("today")}>Back to Today</button>
      </div>
    </section>
    <section className="document"><div className="section-heading"><h2>Skill placement</h2></div>
      <ul className="skill-list">{DIAGNOSTIC_SKILLS.map(skill => <li key={skill.id}>
        <span>{skill.title}{session.responses.some(r => r.itemId && r.skillId === skill.id && r.legacy) ? " · Legacy / unverified" : ""}</span>
        <span className="status-label">{profileLabel[profile[skill.id]] ?? profile[skill.id]}</span>
      </li>)}</ul>
      <p className="muted">Observed skills shape your review schedule. Uncertain skills are prioritized for review. Placement never unlocks missions or claims mastery.</p>
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
    <span className="eyebrow">PLACEMENT DIAGNOSTIC</span>
    <h2>This diagnostic session wasn’t found.</h2>
    <p>It may have been cleared with your browser data.</p>
    <div className="button-row">
      <button className="primary" onClick={studio.startDiagnostic}>Start a new diagnostic</button>
      <button className="secondary" onClick={() => studio.navigate("today")}>Back to Today</button>
    </div>
  </section>;

  const latestId = studio.state.diagnosticSessions.at(-1)?.id;
  const interactive = session.status === "in-progress" && session.id === latestId;
  const currentItem = session.currentItemId ? DIAGNOSTIC_ITEMS.find(i => i.id === session.currentItemId) : undefined;

  return <>
    <div className="page-heading">
      <button className="text-button" onClick={() => studio.navigate("today")}>← Today</button>
      <h1 id="page-title" tabIndex={-1}>Placement diagnostic</h1>
      <p>Adaptive questions across nine skills calibrate your starting point. Wrong answers only move you to easier material — they never block you.</p>
    </div>
    <section className="document" aria-label="Diagnostic progress">
      <div className="diagnostic-meta">
        <span><strong>{session.responses.length}</strong> of up to {DIAGNOSTIC_MAX_ITEMS} questions</span>
        <span><strong>{session.codingSuccessCount}</strong> of {DIAGNOSTIC_CODING_QUOTA} successful Python runs</span>
      </div>
      <ProgressBar answered={session.responses.length} />
      {session.status === "in-progress" && !interactive && <p className="muted">A newer session exists, so this one is read-only. Open the latest session to continue.</p>}
    </section>
    {session.status === "completed" && <CompletedSession studio={studio} session={session} />}
    {session.status === "in-progress" && interactive && (currentItem
      ? currentItem.kind === "concept"
        ? <ConceptItem studio={studio} session={session} item={currentItem} />
        : <CodingItem studio={studio} session={session} item={currentItem} />
      : <FinishPanel studio={studio} session={session} />)}
    {session.status === "in-progress" && !interactive && <section className="document empty-state">
      <h2>This session is superseded.</h2>
      <p>Start a fresh retake or return to your latest session.</p>
      <div className="button-row">
        <button className="primary" onClick={studio.retakeDiagnostic}>Start a fresh retake</button>
        <button className="secondary" onClick={() => latestId && studio.openDiagnosticSession(latestId)}>Open latest session</button>
      </div>
    </section>}
    <SessionHistory studio={studio} currentId={session.id} />
  </>;
}

export function DiagnosticStudio({ studio }: { studio: Studio }) {
  return <main id="main-content" className="dashboard"><DiagnosticBody studio={studio} /></main>;
}
