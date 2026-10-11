"use client";
import { useState } from "react";
import { curriculum } from "../../lib/curriculum";
import {
  deriveDiagnosticProfile, latestCompletedDiagnosticSession, type DiagnosticSession,
} from "../../lib/diagnostic";
import { recommendNext, type RecommendationAction } from "../../lib/recommend";
import { getDashboardModel, getEvidenceRows, getLibraryRows, getPortfolioModel, getProjectReview } from "../../lib/studio";
import type { Studio } from "./use-studio";
import { Hud } from "./hud";
import { SkillTree } from "./skill-tree";
import { Achievements } from "./achievements";
import { MissionComplete } from "./mission-complete";
import { getProgressSummary, getTotalXp, getXpEvents, levelFor } from "../../lib/progress";
import { AssessmentWorkbench } from "./assessment-workbench";
import homeCss from "./home.module.css";

const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
function PageHeading({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return <header className="page-heading"><span className="eyebrow">{label}</span><h1 id="page-title" tabIndex={-1}>{title}</h1><p>{children}</p></header>;
}

function PlacementCard({ studio }: { studio: Studio }) {
  const sessions = studio.state.diagnosticSessions;
  const inProgress: DiagnosticSession | undefined = [...sessions].reverse().find(s => s.status === "in-progress");
  const latest = latestCompletedDiagnosticSession(sessions);
  if (inProgress) return <section className="document" aria-label="Placement scan">
    <div className="section-heading"><h2>Placement scan</h2><span className="eyebrow">IN PROGRESS</span></div>
    <p>You’ve answered {inProgress.responses.length} question{inProgress.responses.length === 1 ? "" : "s"} — your current question and drafts are exactly where you left them.</p>
    <div className="button-row"><button className="primary" onClick={() => studio.openDiagnosticSession(inProgress.id)}>Resume scan →</button></div>
  </section>;
  if (latest) {
    const { recommendation, legacyCount } = deriveDiagnosticProfile(latest);
    return <section className="document" aria-label="Placement scan">
      <div className="section-heading"><h2>Placement scan</h2><span className="eyebrow">COMPLETED {formatDate(latest.completedAt ?? latest.startedAt).toUpperCase()}</span></div>
      <p>{recommendation}</p>
      {legacyCount > 0 && <p className="muted">{legacyCount} older response{legacyCount === 1 ? "" : "s"} could not be used to set your starting point.</p>}
      <div className="button-row">
        <button className="primary" onClick={() => studio.openDiagnosticSession(latest.id)}>View scan →</button>
        <button className="secondary" onClick={studio.retakeDiagnostic}>Retake</button>
      </div>
    </section>;
  }
  return <section className="document" aria-label="Placement scan">
    <div className="section-heading"><h2>Placement scan</h2><span className="eyebrow">RECOMMENDED FIRST</span></div>
    <p>A short adaptive scan finds a useful starting point. Wrong answers only guide you to easier material; they never block you.</p>
    <div className="button-row"><button className="primary" onClick={studio.startDiagnostic}>Start placement scan →</button></div>
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
    <p className="muted">Clears your placement sessions and placement summary so a new scan starts fresh. Missions, checkpoints, your evidence log, and portfolio snapshots are kept.</p>
    <div className="button-row"><button className="text-button danger" onClick={() => setConfirming(true)}>Reset placement</button></div>
  </section>;
  return <section className="document" aria-label="Confirm placement reset">
    <div className="section-heading"><h2>Reset placement?</h2><span className="eyebrow">CONFIRM</span></div>
    <p role="alert">This permanently clears {sessions.length} saved placement session{sessions.length === 1 ? "" : "s"} and your placement summary. Missions, checkpoint assessments, your evidence log, and portfolio snapshots are not affected.</p>
    <div className="button-row">
      <button className="secondary danger" onClick={() => { setConfirming(false); studio.resetPlacement(); }}>Yes, reset placement</button>
      <button className="secondary" onClick={() => setConfirming(false)}>Keep my placement</button>
    </div>
  </section>;
}

function Today({ studio }: { studio: Studio }) {
  const model = getDashboardModel(studio.state); const progress = getProgressSummary(studio.state);
  const due = model.reviews.filter(review => review.dueAt <= new Date().toISOString());
  const locked = getLibraryRows(studio.state).find(row => row.blockedReason);
  const checkpointsReady = recommendNext(studio.state).action === "assessment" ? 1 : 0;
  const achievements = progress.achievements.filter(item => item.unlocked).slice(-3).reverse();
  return <><PageHeading label="HOME" title="Your next run starts here.">One clear next step. Your progress stays yours.</PageHeading><div className={homeCss.layout}><div className={homeCss.primaryColumn}><Hud state={studio.state} reviewsDue={due.length} checkpointsReady={checkpointsReady}/><RecommendationCard studio={studio}/></div><aside className={`home-queue hud-panel ${homeCss.queue}`} aria-label="Your queue"><h2>QUEUE</h2><section><h3>Due reviews</h3>{due.length ? <ul>{due.slice(0, 3).map(item => <li key={item.skillId}>{curriculum.skills.find(skill => skill.id === item.skillId)?.title ?? "Skill review"} · {formatDate(item.dueAt)}</li>)}</ul> : <p>Nothing due</p>}</section><section><h3>Next locked mission</h3>{locked ? <p>{locked.mission.title} · {locked.blockedReason}</p> : <p>No locked mission</p>}</section><section><h3>Recent XP</h3>{progress.recent.length ? <ul>{progress.recent.slice(0, 3).map(event => <li key={event.id}>+{event.xp} XP · {event.label}</li>)}</ul> : <p>Your first XP arrives with a completed run.</p>}</section><section><h3>Latest achievements</h3>{achievements.length ? <ul>{achievements.map(item => <li key={item.id}>{item.glyph} {item.title}</li>)}</ul> : <p>Your first achievement is waiting.</p>}</section></aside></div><details className="system-disclosure"><summary>System</summary><PlacementCard studio={studio}/><ResetPlacement studio={studio}/><p>Your work saves on this device and syncs when online.</p></details></>;
}
const RECOMMENDATION_EYEBROW: Record<RecommendationAction, string> = {
  resume: "RESUME", diagnostic: "PLACEMENT SCAN", "start-mission": "NEXT MISSION",
  repair: "WARM-UP", retrieval: "REVIEW", assessment: "CHECKPOINT", complete: "COMPLETE",
};

function RecommendationCard({ studio }: { studio: Studio }) {
  const rec = recommendNext(studio.state);
  const mission = rec.missionId ? curriculum.missions.find(m => m.id === rec.missionId) : null;
  const actions: Record<RecommendationAction, { label: string; run: () => void }> = {
    resume: { label: "Resume mission", run: () => studio.start() },
    diagnostic: { label: "Start placement scan", run: () => studio.startDiagnostic() },
    "start-mission": { label: "Start mission", run: () => studio.start(undefined, rec.reviewTaskIds) },
    repair: { label: "Start warm-up", run: () => studio.start(undefined, rec.reviewTaskIds) },
    retrieval: { label: "Start review", run: () => studio.start(undefined, rec.reviewTaskIds) },
    assessment: { label: "Open checkpoint", run: () => studio.navigate("assessment") },
    complete: { label: "Review skill graph", run: () => studio.navigate("learned") },
  };
  const action = actions[rec.action];
  return <section className={`document ${homeCss.hero}`} aria-label="Recommended next step">
    <div className={homeCss.terminalBar}><span aria-hidden="true">● ● ●</span><span>next_run.sh</span></div>
    <div className="section-heading"><span className="eyebrow">{RECOMMENDATION_EYEBROW[rec.action]}</span></div>
    <h2>{mission?.title ?? (rec.action === "diagnostic" ? "Find your starting point" : rec.action === "assessment" ? "Clear your next checkpoint" : "Your next step")}</h2>
    <p>{rec.reason}</p>
    <div className={homeCss.chips}><span className="chip chip-cyan">{mission?.estimatedMinutes ?? 5} MIN</span><span className="chip chip-violet">+XP</span></div>
    {mission && <ol className={homeCss.pipeline} aria-label="Mission stages"><li>BRIEF</li><li>BUILD</li><li>CHECK</li><li>SHIP</li></ol>}
    <div className="button-row"><button className={`primary ${homeCss.cta}`} onClick={action.run}>{action.label} →</button></div>
  </section>;
}

function Lessons({ studio }: { studio: Studio }) {
  return <><PageHeading label="MISSIONS" title="Choose your next mission.">Clear missions in order. Each run earns effort XP.</PageHeading><section className="document lesson-library" aria-labelledby="library-title"><div className="library-group"><h2 id="library-title">Coding practice missions</h2><p>Graded exercises currently available in the workbench</p></div>{getLibraryRows(studio.state).map((row, index) => <article className={`lesson-row${row.blockedReason ? " locked" : ""}`} key={row.mission.id}>
      <span className="lesson-index" aria-label={`Mission ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>{row.blockedReason && <span className="lesson-lock" aria-label="Locked">🔒</span>}<div className="lesson-description"><span className="chip">{row.blockedReason ? "LOCKED" : row.status === "Completed" ? "CLEARED" : row.status === "In progress" ? "ACTIVE" : "READY"}</span><span className="chip chip-violet">+{row.xp} XP</span><h3>{row.mission.title}</h3><p>{row.mission.summary}</p><span className="artifact-label">Artifact · {row.artifact}</span>{row.blockedReason && <p className="prerequisite">{row.blockedReason}</p>}</div><div className="lesson-action"><span className="duration">{row.mission.estimatedMinutes} min</span><button className="secondary" disabled={Boolean(row.blockedReason)} onClick={() => studio.start(row.mission.id)}>{row.status === "In progress" ? "Resume mission" : row.status === "Completed" ? "Practice again" : "Open mission"}<span aria-hidden="true"> →</span></button></div>
    </article>)}</section></>;
}

function Learned({ studio }: { studio: Studio }) {
  const rows = getEvidenceRows(studio.state);
  const [filter, setFilter] = useState<"all" | "passed" | "needs-work">("all");
  const gradedRows = rows.filter(row => row.attempt.purpose !== "instruction" && row.attempt.purpose !== "reflection");
  const visibleRows = gradedRows.filter(row => filter === "all" || (filter === "passed" ? row.attempt.passed : !row.attempt.passed));
  return <><PageHeading label="SKILL TREE" title="Your skills, mapped.">Skill status grows from evidence over time. XP tracks effort.</PageHeading><SkillTree state={studio.state} /><Achievements items={getProgressSummary(studio.state).achievements} /><h2 className={homeCss.syslog}>syslog</h2>{gradedRows.length ? <><section className="evidence-filters" aria-label="Filter evidence">{(["all", "passed", "needs-work"] as const).map(value => <button key={value} type="button" className={filter === value ? "chip chip-cyan" : "chip"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "needs-work" ? "Needs work" : value}</button>)}</section><section className="evidence-list" aria-label="Saved attempts">{visibleRows.map(row => {
    const label = row.attempt.purpose === "instruction" ? "Lesson read" : row.attempt.purpose === "reflection" ? "Reflection saved" : row.attempt.passed ? "Passed" : row.attempt.executionOk ? "Needs changes" : "Couldn't run";
    const purpose = row.attempt.purpose === "retrieval" ? "Review" : row.attempt.purpose === "guided-practice" ? "Guided practice" : "Project";
    return <details className="document evidence-entry" key={row.attempt.id}><summary><div className="evidence-date"><time dateTime={row.attempt.completedAt}>{formatDate(row.attempt.completedAt)}</time><span>{new Date(row.attempt.completedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></div><div className="evidence-description"><h2>{row.title}</h2><p>{purpose} · {row.assistance}</p><span>{`${row.attempt.checks.filter(c => c.passed).length}/${row.attempt.checks.length} checks passed`}{row.nextReview ? ` · Next review ${formatDate(row.nextReview)}` : " · No review scheduled"}</span></div><span className={`result-label ${row.attempt.passed ? "success" : "failure"}`}>{label}</span><span className="details-chevron" aria-hidden="true">⌄</span></summary><div className="evidence-details"><p className="muted">{row.missionTitle}{row.attempt.duplicateOf ? " · Repeated submission; no additional mastery credit." : ""}</p><details><summary>View source files</summary>{Object.entries(row.attempt.sourceFiles).map(([file, source]) => <div key={file}><h3>{file}</h3><pre>{source}</pre></div>)}</details>{row.attempt.response && <div><h3>Your reflection</h3><p>{row.attempt.response}</p></div>}{row.attempt.checks.length > 0 && <ul className="saved-checks">{row.attempt.checks.map(check => <li key={check.id}><strong>{check.passed ? "Passed" : "Needs changes"}: {check.name}</strong>{check.detail && <p>{check.detail}</p>}</li>)}</ul>}<p className="muted">{row.assistance}. {row.attempt.purpose === "guided-practice" ? "Guided practice does not establish independent project evidence." : row.attempt.purpose === "project" && row.attempt.passed ? "Mastery requires varied independent evidence and later review." : "This is a record of this attempt only."}</p></div></details>;
  })}</section></> : <section className="document large-empty"><span className="empty-mark" aria-hidden="true">[ ]</span><h2>No graded attempts yet.</h2><p>Complete a mission to see your checks and evidence here.</p><button className="primary" onClick={() => studio.start()}>Start your first mission →</button></section>}</>;
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
    <h3>Remaining practice</h3>{review.remaining.length ? <ul className="saved-checks">{review.remaining.map(item => <li key={item}>{item}</li>)}</ul> : <p>No failed checks on this latest project and no reviews due now. Future reviews will test retention.</p>}
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
  const attemptIds = new Set(run.attemptIds);
  const runEvents = getXpEvents(studio.state).filter(event => attemptIds.has(event.id.slice(event.id.indexOf(":") + 1)));
  const xp = runEvents.reduce((total, event) => total + event.xp, 0);
  const totalXp = getTotalXp(studio.state);
  const beforeLevel = levelFor(Math.max(0, totalXp - xp)).level;
  const currentLevel = levelFor(totalXp).level;
  const mission = curriculum.missions.find(item => item.id === run.missionId);
  const artifact = rows.find(row => row.attempt.purpose === "project")?.title ?? mission?.title ?? "Run saved";
  const next = recommendNext(studio.state);
  const nextMission = next.missionId ? curriculum.missions.find(item => item.id === next.missionId) : undefined;
  const nextLabel = nextMission?.title ?? (next.action === "assessment" ? "Open your next checkpoint" : "Choose a mission");
  const passed = rows.filter(row => row.attempt.passed && row.attempt.executionOk).length;
  const graded = rows.filter(row => row.attempt.purpose !== "instruction" && row.attempt.purpose !== "reflection").length;
  const checksLine = graded ? `${passed}/${graded} passed` : "saved";
  return <><PageHeading label="RUN COMPLETE" title="Run complete.">Your effort is recorded. Skill status still comes from evidence.</PageHeading><MissionComplete checks={checksLine} artifact={artifact} xp={xp} levelUp={currentLevel > beforeLevel ? `LEVEL UP · ${levelFor(totalXp).title}` : undefined} next={nextLabel} primary={<button className="primary" onClick={() => next.action === "assessment" ? studio.navigate("assessment") : nextMission ? studio.start(nextMission.id) : studio.navigate("lessons")}>Next mission →</button>} secondary={<button className="secondary" onClick={() => studio.navigate("today")}>Home</button>} />
    {run.mode === "review" && <section className="document"><h2>Review results</h2>{rows.filter(row => row.attempt.purpose === "retrieval").map(row => <article key={row.attempt.id}><h3>{row.title}</h3><p>{row.attempt.passed ? "Passed" : "Needs changes"} · {row.attempt.checks.filter(c => c.passed).length} of {row.attempt.checks.length} checks passed · {row.assistance}</p></article>)}</section>}
    <details className="project-review-disclosure"><summary>Project review</summary><ProjectReview studio={studio} runId={run.id} /></details></>;
}

function Portfolio({ studio }: { studio: Studio }) {
  const projects = getPortfolioModel(studio.state);
  const completedCount = projects.reduce((n, p) => n + p.snapshots.length, 0);
  return <><PageHeading label="PORTFOLIO" title="Ship it. Prove it.">Finished portfolio projects are sealed into shipped crates — your source, the fixtures, the named tests, and your reflection. Download any project as a ZIP.</PageHeading>{completedCount ? <div>{projects.map(({ project, snapshots, complete }) => {
    const byComponent = new Map(snapshots.map(s => [s.componentId, s]));
    const missingTitles = project.components.filter(c => !byComponent.has(c.taskId)).map(c => c.title).join(", ");
    return <section className="document" aria-label={project.title} key={project.id}>
      <span className="eyebrow">PORTFOLIO PROJECT</span>
      <h2>{project.title}</h2>
      <p>{project.objective}</p>
      <p className="muted">{snapshots.length} of {project.components.length} components completed{complete ? " · Project complete" : ""}</p>
      <ul className="saved-checks">{project.components.map(component => {
        const snapshot = byComponent.get(component.taskId);
        return <li key={component.taskId}><strong>{snapshot ? "Completed" : "Not completed yet"}: {component.title}</strong>{snapshot && <p>Sealed {formatDate(snapshot.completedAt)} · {snapshot.tests.filter(t => t.passed).length}/{snapshot.tests.length} checks passed · {snapshot.assistance.hintsUsed} hints used</p>}</li>;
      })}</ul>
      {complete
        ? <div className="button-row"><button className="primary" onClick={() => studio.downloadPortfolio(project.id)}>Download ZIP<span aria-hidden="true"> ↓</span></button></div>
        : snapshots.length > 0 && <p className="muted">Complete {missingTitles} to unlock the ZIP export export.</p>}
    </section>;
  })}</div> : <section className="document large-empty"><span className="empty-mark" aria-hidden="true">[ ]</span><h2>No portfolio snapshots yet.</h2><p>Complete a mission whose build project feeds a portfolio project — for example, the payments CSV mission. Its snapshot appears here the moment the mission completes.</p><button className="primary" onClick={() => studio.navigate("lessons")}>Browse missions →</button></section>}</>;
}

export function Dashboard({ studio }: { studio: Studio }) {
  return <main id="main-content" className="dashboard">{studio.route.completedRunId ? <Completion studio={studio} /> : studio.route.destination === "lessons" ? <Lessons studio={studio} /> : studio.route.destination === "learned" ? <Learned studio={studio} /> : studio.route.destination === "assessment" ? <Assessment studio={studio} /> : studio.route.destination === "portfolio" ? <Portfolio studio={studio} /> : <Today studio={studio} />}</main>;
}









