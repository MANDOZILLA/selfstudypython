"use client";
import { useState } from "react";
import { curriculum } from "../../lib/curriculum";
import { DIAGNOSTIC_SKILLS } from "../../curriculum";
import {
  DIAGNOSTIC_CODING_QUOTA, DIAGNOSTIC_UNKNOWN_ANSWER,
  deriveDiagnosticProfile, latestCompletedDiagnosticSession, type DiagnosticSession,
} from "../../lib/diagnostic";
import { recommendNext, type RecommendationAction } from "../../lib/recommend";
import { buildSkillGraph, type GraphSkillStatus } from "../../lib/skill-graph";
import { getDashboardModel, getEvidenceRows, getLibraryRows, getPortfolioModel, getProjectReview } from "../../lib/studio";
import type { Studio } from "./use-studio";
import { StageRail } from "./stage-rail";
import { Hud } from "./hud";
import { SkillTree } from "./skill-tree";
import { Achievements } from "./achievements";
import { getProgressSummary } from "../../lib/progress";
import { AssessmentWorkbench } from "./assessment-workbench";

const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
function PageHeading({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return <header className="page-heading"><span className="eyebrow">{label}</span><h1 id="page-title" tabIndex={-1}>{title}</h1><p>{children}</p></header>;
}

function PlacementCard({ studio }: { studio: Studio }) {
  const sessions = studio.state.diagnosticSessions;
  const inProgress: DiagnosticSession | undefined = [...sessions].reverse().find(s => s.status === "in-progress");
  const latest = latestCompletedDiagnosticSession(sessions);
  if (inProgress) return <section className="document" aria-label="Placement diagnostic">
    <div className="section-heading"><h2>Placement diagnostic</h2><span className="eyebrow">IN PROGRESS</span></div>
    <p>Youâ€™ve answered {inProgress.responses.length} question{inProgress.responses.length === 1 ? "" : "s"} â€” your current question and drafts are exactly where you left them.</p>
    <div className="button-row"><button className="primary" onClick={() => studio.openDiagnosticSession(inProgress.id)}>Resume diagnostic â†’</button></div>
  </section>;
  if (latest) {
    const { recommendation, legacyCount } = deriveDiagnosticProfile(latest);
    return <section className="document" aria-label="Placement diagnostic">
      <div className="section-heading"><h2>Placement diagnostic</h2><span className="eyebrow">COMPLETED {formatDate(latest.completedAt ?? latest.startedAt).toUpperCase()}</span></div>
      <p>{recommendation}</p>
      {legacyCount > 0 && <p className="muted"><strong>Legacy / unverified:</strong> {legacyCount} response{legacyCount === 1 ? "" : "s"} used an older grader and didnâ€™t affect placement.</p>}
      <div className="button-row">
        <button className="primary" onClick={() => studio.openDiagnosticSession(latest.id)}>View placement â†’</button>
        <button className="secondary" onClick={studio.retakeDiagnostic}>Retake</button>
      </div>
    </section>;
  }
  return <section className="document" aria-label="Placement diagnostic">
    <div className="section-heading"><h2>Placement diagnostic</h2><span className="eyebrow">RECOMMENDED FIRST</span></div>
    <p>Twelve to twenty-five adaptive questions start at the AP Computer Science Principles (AP CSP) foundation tier, adapted to Python, then branch across {DIAGNOSTIC_SKILLS.length} skills to find your starting point. Wrong answers only move you to easier material â€” they never block you. Coding evidence is flexible: {DIAGNOSTIC_CODING_QUOTA} successful Python runs, {DIAGNOSTIC_CODING_QUOTA} honest â€œ{DIAGNOSTIC_UNKNOWN_ANSWER}â€ declarations, or one of each.</p>
    <div className="button-row"><button className="primary" onClick={studio.startDiagnostic}>Take the placement diagnostic â†’</button></div>
  </section>;
}

/** Confirmed, diagnostic-only reset: sessions and the placement summary are
 *  cleared through the normal persisted state commit; missions, checkpoint
 *  assessments, evidence, and portfolio data are kept. */
function ResetPlacement({ studio }: { studio: Studio }) {
  const [confirming, setConfirming] = useState(false);
  const sessions = studio.state.diagnosticSessions;
  if (!sessions.length && !studio.state.diagnostic.completed) return null;
  if (!confirming) return <section className="document" aria-label="Reset placement">
    <div className="section-heading"><h2>Reset placement</h2><span className="eyebrow">START OVER</span></div>
    <p className="muted">Clears your diagnostic sessions and placement summary so the placement diagnostic starts from scratch. Missions, checkpoint assessments, your evidence log, and portfolio snapshots are kept.</p>
    <div className="button-row"><button className="text-button danger" onClick={() => setConfirming(true)}>Reset placement</button></div>
  </section>;
  return <section className="document" aria-label="Confirm placement reset">
    <div className="section-heading"><h2>Reset placement?</h2><span className="eyebrow">CONFIRM</span></div>
    <p role="alert">This permanently clears {sessions.length} saved diagnostic session{sessions.length === 1 ? "" : "s"} and your placement summary. Missions, checkpoint assessments, your evidence log, and portfolio snapshots are not affected.</p>
    <div className="button-row">
      <button className="secondary danger" onClick={() => { setConfirming(false); studio.resetPlacement(); }}>Yes, reset placement</button>
      <button className="secondary" onClick={() => setConfirming(false)}>Keep my placement</button>
    </div>
  </section>;
}

function Today({ studio }: { studio: Studio }) {
 const model=getDashboardModel(studio.state); const progress=getProgressSummary(studio.state);
 return <><PageHeading label="HOME" title="Your next run starts here.">One clear next step. Your progress stays yours.</PageHeading><Hud state={studio.state}/><RecommendationCard studio={studio}/><aside className="home-queue hud-panel"><h2>QUEUE</h2><p>{model.reviews.filter(r=>r.dueAt<=new Date().toISOString()).length} reviews due</p><p>{progress.recent[0] ? `+${progress.recent[0].xp} XP · ${progress.recent[0].label}` : "Your XP events will appear here."}</p><p>{progress.unlocked} achievements unlocked</p><button className="secondary" onClick={()=>studio.navigate("assessment")}>Open checkpoints</button></aside><details className="system-disclosure"><summary>System</summary><PlacementCard studio={studio}/><ResetPlacement studio={studio}/><p>Your work saves on this device and syncs when online.</p></details></>;
}
const RECOMMENDATION_EYEBROW: Record<RecommendationAction, string> = {
  resume: "RESUME", diagnostic: "PLACEMENT", "start-mission": "NEXT MISSION",
  repair: "REPAIR", retrieval: "RETRIEVAL", assessment: "CHECKPOINT", complete: "COMPLETE",
};

function RecommendationCard({ studio }: { studio: Studio }) {
  const rec = recommendNext(studio.state);
  const mission = rec.missionId ? curriculum.missions.find(m => m.id === rec.missionId) : null;
  const actions: Record<RecommendationAction, { label: string; run: () => void }> = {
    resume: { label: "Resume mission", run: () => studio.start() },
    diagnostic: { label: "Start placement diagnostic", run: () => studio.startDiagnostic() },
    "start-mission": { label: "Start mission", run: () => studio.start(undefined, rec.reviewTaskIds) },
    repair: { label: "Start repair", run: () => studio.start(undefined, rec.reviewTaskIds) },
    retrieval: { label: "Start retrieval", run: () => studio.start(undefined, rec.reviewTaskIds) },
    assessment: { label: "Open checkpoint", run: () => studio.navigate("assessment") },
    complete: { label: "Review skill graph", run: () => studio.navigate("learned") },
  };
  const action = actions[rec.action];
  return <section className="document" aria-label="Recommended next step">
    <div className="section-heading"><h2>Recommended next</h2><span className="eyebrow">{RECOMMENDATION_EYEBROW[rec.action]}</span></div>
    {mission && <p className="muted">{mission.title}{rec.blockedMissionId ? " Â· blocked until the repair is done" : ""}</p>}
    <p>{rec.reason}</p>
    <div className="button-row"><button className="primary" onClick={action.run}>{action.label} â†’</button></div>
  </section>;
}

function Lessons({ studio }: { studio: Studio }) {
  return <><PageHeading label="MISSIONS" title="Choose your next mission.">Clear missions in order. Each run earns effort XP.</PageHeading><section className="document lesson-library" aria-labelledby="library-title"><div className="library-group"><h2 id="library-title">Coding practice missions</h2><p>Graded exercises currently available in the workbench</p></div>{getLibraryRows(studio.state).map((row, index) => <article className="lesson-row" key={row.mission.id}>
      <span className="lesson-index" aria-label={`Mission ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span><div className="lesson-description"><span className="chip">{row.blockedReason ? "LOCKED" : row.status === "Completed" ? "CLEARED" : row.status === "In progress" ? "ACTIVE" : "READY"}</span><span className="chip chip-violet">+{row.xp} XP</span><h3>{row.mission.title}</h3><p>{row.mission.summary}</p><span className="artifact-label">Artifact Â· {row.artifact}</span>{row.blockedReason && <p className="prerequisite">{row.blockedReason}</p>}</div><div className="lesson-action"><span className="duration">{row.mission.estimatedMinutes} min</span><button className="secondary" disabled={Boolean(row.blockedReason)} onClick={() => studio.start(row.mission.id)}>{row.status === "In progress" ? "Resume mission" : row.status === "Completed" ? "Practice again" : "Open mission"}<span aria-hidden="true"> â†’</span></button></div>
    </article>)}</section><p className="page-footnote">The roadmap above follows the supplied curriculum. The coding practice missions are existing graded exercises and do not cover every unit yet.</p></>;
}

const SKILL_STATUS_LABELS: Record<GraphSkillStatus, string> = {
  untested: "Untested",
  "needs-practice": "Needs practice",
  "working-evidence": "Working evidence",
  "demonstrated-in-project": "Demonstrated in project",
  "demonstrated-again-later": "Demonstrated again later",
  mastered: "Mastered",
};

function SkillGraphSection({ studio }: { studio: Studio }) {
  const graph = buildSkillGraph(studio.state);
  return <section className="document" aria-labelledby="skill-graph-title">
    <div className="section-heading"><h2 id="skill-graph-title">Skill graph</h2><span className="eyebrow">ADAPTIVE</span></div>
    <p className="muted">One qualitative status per skill â€” never a percentage. Status comes from independent evidence: project work, later retrieval in new contexts, and spaced reviews. Placement only suggests where to start; it never grants status.</p>
    {graph.map(node => <details className="evidence-entry" key={node.skillId}>
      <summary><div className="evidence-description"><h2>{node.name}</h2><p>{node.evidenceCount} evidence Â· {node.lastDemonstratedAt ? `last demonstrated ${formatDate(node.lastDemonstratedAt)}` : "not yet demonstrated"}</p></div><span className="status-label">{SKILL_STATUS_LABELS[node.status]}</span><span className="details-chevron" aria-hidden="true">âŒ„</span></summary>
      <div className="evidence-details">
        <p><strong>Prerequisites:</strong> {node.prerequisites.length ? node.prerequisites.map(p => p.name).join(", ") : "None"}</p>
        <p><strong>Next review:</strong> {node.nextReviewAt ? `${formatDate(node.nextReviewAt)} Â· ${node.nextReviewReason}` : "Not scheduled"}</p>
        <p>{node.readiness}</p>
        {node.placement !== "untested" && <p className="muted">Placement signal: {node.placement} â€” placement only, not a status.</p>}
        {node.evidenceTasks.length > 0 && <><h3>Tasks providing evidence</h3><ul className="saved-checks">{node.evidenceTasks.map(task => <li key={`${task.taskId}-${task.completedAt}`}>{task.title} Â· {task.kind} Â· {formatDate(task.completedAt)} Â· {task.passed ? "passed" : "needs changes"}{task.independent ? "" : " Â· assisted"}</li>)}</ul></>}
      </div>
    </details>)}
  </section>;
}

function Learned({ studio }: { studio: Studio }) {
  const rows = getEvidenceRows(studio.state);
  return <><PageHeading label="EVIDENCE LOG" title="Your work, with the receipts.">Saved attempts show what you tried, what passed, and how much help you used.</PageHeading><SkillTree state={studio.state} /><Achievements items={getProgressSummary(studio.state).achievements} />{rows.length ? <section className="evidence-list" aria-label="Saved attempts">{rows.map(row => {
    const code = row.attempt.purpose !== "instruction" && row.attempt.purpose !== "reflection";
    const label = row.attempt.purpose === "instruction" ? "Lesson read" : row.attempt.purpose === "reflection" ? "Reflection saved" : row.attempt.passed ? "Passed" : row.attempt.executionOk ? "Needs changes" : "Couldn't run";
    return <details className="document evidence-entry" key={row.attempt.id}><summary><div className="evidence-date"><time dateTime={row.attempt.completedAt}>{formatDate(row.attempt.completedAt)}</time><span>{new Date(row.attempt.completedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></div><div className="evidence-description"><h2>{row.title}</h2><p>{row.attempt.purpose.replaceAll("-", " ")} Â· {row.assistance}</p><span>{code ? `${row.attempt.checks.filter(c => c.passed).length}/${row.attempt.checks.length} checks passed` : "Not a graded skill claim"}{row.nextReview ? ` Â· Next review ${formatDate(row.nextReview)}` : " Â· No review scheduled"}</span></div><span className={`result-label ${code ? row.attempt.passed ? "success" : "failure" : ""}`}>{label}</span><span className="details-chevron" aria-hidden="true">âŒ„</span></summary><div className="evidence-details"><p className="muted">{row.missionTitle}{row.attempt.duplicateOf ? " Â· Repeated submission; no additional mastery credit." : ""}</p>{Object.entries(row.attempt.sourceFiles).map(([file, source]) => <div key={file}><h3>{file}</h3><pre>{source}</pre></div>)}{row.attempt.response && <div><h3>Your reflection</h3><p>{row.attempt.response}</p></div>}{row.attempt.checks.length > 0 && <ul className="saved-checks">{row.attempt.checks.map(check => <li key={check.id}><strong>{check.passed ? "Passed" : "Needs changes"}: {check.name}</strong>{check.detail && <p>{check.detail}</p>}</li>)}</ul>}<p className="muted">{row.assistance}. {row.attempt.purpose === "guided-practice" ? "Guided practice does not establish independent project evidence." : row.attempt.purpose === "project" && row.attempt.passed ? "Mastery requires varied independent evidence and later retrieval." : "This is a record of this attempt only."}</p></div></details>;
  })}</section> : <section className="document large-empty"><span className="empty-mark" aria-hidden="true">[ ]</span><h2>No saved attempts yet.</h2><p>Start a mission to create your first learning record. Your code, check results, hints, and reflections will appear here.</p><button className="primary" onClick={() => studio.start()}>Start your first mission â†’</button></section>}</>;
}

function ProjectReview({ studio, runId, actions }: { studio: Studio; runId?: string; actions?: React.ReactNode }) {
  const review = getProjectReview(studio.state, runId);
  if (!review.project) return null;
  const passedChecks = review.project.checks.filter(check => check.passed).length;
  const failedChecks = review.project.checks.length - passedChecks;
  return <section className="document assessment-document">
    <span className="eyebrow">LATEST PROJECT REVIEW</span><h2>{review.title}</h2>
    <section className="review-outcome" aria-labelledby="review-outcome-title"><h3 id="review-outcome-title">Outcome</h3><p>{review.project.passed ? "The required checks passed for this saved project." : "This saved project needs changes."} {passedChecks} of {review.project.checks.length} verified checks passed.</p><p className="review-meta">Project assistance: {review.assistance}. Completed {formatDate(review.project.completedAt)}.</p></section>
    <h3>Evidence-backed strengths</h3>{review.skills.some(s => s.evidenceAttemptIds.length) ? <ul className="skill-list">{review.skills.filter(s => s.evidenceAttemptIds.length).map(s => <li key={s.skillId}><span>{s.title}</span><span>{s.status}</span></li>)}</ul> : <p>No independent project strengths established yet. Assisted work remains practice.</p>}
    <h3>Remaining practice</h3>{review.remaining.length ? <ul className="saved-checks">{review.remaining.map(item => <li key={item}>{item}</li>)}</ul> : <p>No failed checks on this latest project and no reviews due now. Future retrieval will test retention.</p>}
    <h3>Your reflection</h3><p className="review-reflection">{review.reflection?.response || "No reflection saved for this project yet."}</p>
    {actions && <div className="button-row summary-actions review-actions">{actions}</div>}
    <details className="review-disclosure saved-artifact-disclosure"><summary><span>Saved artifact</span><span>View source files</span></summary><div className="review-disclosure-content">{Object.entries(review.project.sourceFiles).map(([name, source]) => <div className="saved-artifact" key={name}><strong>{name}</strong><pre>{source}</pre></div>)}</div></details>
    <details className="review-disclosure saved-checks-disclosure"><summary><span>Complete verified checks</span><span>{passedChecks} passed{failedChecks ? `, ${failedChecks} need changes` : ""}</span></summary><div className="review-disclosure-content"><ul className="saved-checks">{review.project.checks.map(c => <li key={c.id}><strong>{c.passed ? "Passed" : "Needs changes"}: {c.name}</strong>{c.detail && <p>{c.detail}</p>}</li>)}</ul></div></details>
  </section>;
}

function Assessment({ studio }: { studio: Studio }) {
  return <AssessmentWorkbench studio={studio} />;
}

function Completion({ studio }: { studio: Studio }) {
  const run = studio.state.missionRuns.find(r => r.id === studio.route.completedRunId && r.status === "completed");
  if (!run) return <Today studio={studio} />;
  const rows = getEvidenceRows(studio.state).filter(row => row.attempt.runId === run.id);
  const checks = rows.filter(row => row.attempt.purpose === "retrieval");
  return <><PageHeading label={run.mode === "review" ? "REVIEW COMPLETE" : "MISSION COMPLETE"} title={run.mode === "review" ? "Your review is saved." : "Your project and reflection are saved."}>{run.mode === "review" ? "Your actual retrieval results update the next practice date." : "Review the outcome and evidence before choosing what to practise next."}</PageHeading>
    {run.mode === "review" ? <section className="document"><h2>Retrieval results</h2>{checks.map(row => <article key={row.attempt.id}><h3>{row.title}</h3><p>{row.attempt.passed ? "Passed" : "Needs changes"} Â· {row.attempt.checks.filter(c => c.passed).length} of {row.attempt.checks.length} checks passed Â· {row.assistance}</p><p>{row.nextReview ? `Next review: ${formatDate(row.nextReview)}` : "No review scheduled."}</p></article>)}<p>Your completed project history is unchanged.</p></section> : <><ProjectReview studio={studio} runId={run.id} actions={<><button className="primary" onClick={() => studio.navigate("learned")}>Go to What I Learned â†’</button><button className="secondary" onClick={() => studio.navigate("today")}>Back to Today</button></>} /><section className="document completion-record"><h2>What changed</h2><p>{curriculum.missions.find(m => m.id === run.missionId)?.title} is now Completed in Lessons.</p><ul className="saved-checks">{rows.map(row => <li key={row.attempt.id}>{row.title}: {row.assistance}{row.attempt.purpose === "instruction" || row.attempt.purpose === "reflection" ? " Â· saved" : row.attempt.passed ? " Â· passed" : " Â· needs changes"}</li>)}</ul><p>Skill status above comes from independent evidence. Reading, assisted practice, and reflection alone do not establish mastery.</p></section></>}
    {run.mode === "review" && <div className="button-row summary-actions"><button className="primary" onClick={() => studio.navigate("learned")}>Go to What I Learned â†’</button><button className="secondary" onClick={() => studio.navigate("today")}>Back to Today</button></div>}</>;
}

function Portfolio({ studio }: { studio: Studio }) {
  const projects = getPortfolioModel(studio.state);
  const completedCount = projects.reduce((n, p) => n + p.snapshots.length, 0);
  return <><PageHeading label="PORTFOLIO" title="Ship it. Prove it.">Finished portfolio projects are sealed into shipped crates â€” your source, the fixtures, the named tests, and your reflection. Download any project as a ZIP.</PageHeading>{completedCount ? <div>{projects.map(({ project, snapshots, complete }) => {
    const byComponent = new Map(snapshots.map(s => [s.componentId, s]));
    const missingTitles = project.components.filter(c => !byComponent.has(c.taskId)).map(c => c.title).join(", ");
    return <section className="document" aria-label={project.title} key={project.id}>
      <span className="eyebrow">PORTFOLIO PROJECT</span>
      <h2>{project.title}</h2>
      <p>{project.objective}</p>
      <p className="muted">{snapshots.length} of {project.components.length} components completed{complete ? " Â· Project complete" : ""}</p>
      <ul className="saved-checks">{project.components.map(component => {
        const snapshot = byComponent.get(component.taskId);
        return <li key={component.taskId}><strong>{snapshot ? "Completed" : "Not completed yet"}: {component.title}</strong>{snapshot && <p>Sealed {formatDate(snapshot.completedAt)} Â· {snapshot.tests.filter(t => t.passed).length}/{snapshot.tests.length} checks passed Â· {snapshot.assistance.hintsUsed} hints used</p>}</li>;
      })}</ul>
      {complete
        ? <div className="button-row"><button className="primary" onClick={() => studio.downloadPortfolio(project.id)}>Download ZIP<span aria-hidden="true"> â†“</span></button></div>
        : snapshots.length > 0 && <p className="muted">Complete {missingTitles} to unlock the ZIP export export.</p>}
    </section>;
  })}</div> : <section className="document large-empty"><span className="empty-mark" aria-hidden="true">[ ]</span><h2>No portfolio snapshots yet.</h2><p>Complete a mission whose build project feeds a portfolio project â€” for example, the payments CSV mission. Its snapshot appears here the moment the mission completes.</p><button className="primary" onClick={() => studio.navigate("lessons")}>Browse missions â†’</button></section>}</>;
}

export function Dashboard({ studio }: { studio: Studio }) {
  return <main id="main-content" className="dashboard">{studio.route.completedRunId ? <Completion studio={studio} /> : studio.route.destination === "lessons" ? <Lessons studio={studio} /> : studio.route.destination === "learned" ? <Learned studio={studio} /> : studio.route.destination === "assessment" ? <Assessment studio={studio} /> : studio.route.destination === "portfolio" ? <Portfolio studio={studio} /> : <Today studio={studio} />}</main>;
}









