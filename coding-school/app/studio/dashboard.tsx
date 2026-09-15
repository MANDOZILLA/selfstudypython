import { curriculum } from "../../lib/curriculum";
import { deriveDiagnosticProfile, latestCompletedDiagnosticSession, type DiagnosticSession } from "../../lib/diagnostic";
import { recommendNext, type RecommendationAction } from "../../lib/recommend";
import { buildSkillGraph, type GraphSkillStatus } from "../../lib/skill-graph";
import { getDashboardModel, getEvidenceRows, getLibraryRows, getPortfolioModel, getProjectReview } from "../../lib/studio";
import type { Studio } from "./use-studio";
import { StageRail } from "./stage-rail";
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
    <p>You’ve answered {inProgress.responses.length} question{inProgress.responses.length === 1 ? "" : "s"} — your current question and drafts are exactly where you left them.</p>
    <div className="button-row"><button className="primary" onClick={() => studio.openDiagnosticSession(inProgress.id)}>Resume diagnostic →</button></div>
  </section>;
  if (latest) {
    const { recommendation, legacyCount } = deriveDiagnosticProfile(latest);
    return <section className="document" aria-label="Placement diagnostic">
      <div className="section-heading"><h2>Placement diagnostic</h2><span className="eyebrow">COMPLETED {formatDate(latest.completedAt ?? latest.startedAt).toUpperCase()}</span></div>
      <p>{recommendation}</p>
      {legacyCount > 0 && <p className="muted"><strong>Legacy / unverified:</strong> {legacyCount} response{legacyCount === 1 ? "" : "s"} used an older grader and didn’t affect placement.</p>}
      <div className="button-row">
        <button className="primary" onClick={() => studio.openDiagnosticSession(latest.id)}>View placement →</button>
        <button className="secondary" onClick={studio.retakeDiagnostic}>Retake</button>
      </div>
    </section>;
  }
  return <section className="document" aria-label="Placement diagnostic">
    <div className="section-heading"><h2>Placement diagnostic</h2><span className="eyebrow">RECOMMENDED FIRST</span></div>
    <p>Twelve to twenty-five adaptive questions across nine Python skills find your starting point. Wrong answers only move you to easier material — they never block you.</p>
    <div className="button-row"><button className="primary" onClick={studio.startDiagnostic}>Take the placement diagnostic →</button></div>
  </section>;
}

function Today({ studio }: { studio: Studio }) {
  const model = getDashboardModel(studio.state);
  const reviewOnly = model.selection.kind === "review" || model.run?.mode === "review";
  const available = model.selection.kind !== "complete" && model.mission;
  return <>
    <PageHeading label="TODAY" title="Make room for useful practice.">A small lesson. A working artifact. A clearer understanding of your code.</PageHeading>
    <RecommendationCard studio={studio} />
    {available && model.mission ? <section className="mission-document" aria-labelledby="mission-title">
      <div className="mission-topline"><span className="eyebrow">{reviewOnly && model.run ? "YOUR REVIEW IN PROGRESS" : model.run ? "YOUR MISSION IN PROGRESS" : reviewOnly ? "YOUR SCHEDULED REVIEW" : "YOUR NEXT MISSION"}</span><span className="duration">{reviewOnly ? model.mission.stages[0].estimatedMinutes : model.mission.estimatedMinutes} min <span>· suggested pace</span></span></div>
      <div className="mission-intro"><div><h2 id="mission-title">{reviewOnly ? "Bring a familiar pattern back to mind" : model.mission.title}</h2><p>{reviewOnly ? "Revisit the skills scheduled from your saved attempts. A short retrieval will show what needs practice." : model.mission.summary}</p></div>{!reviewOnly && <div className="artifact-preview" aria-label="Mission artifact"><span className="file-symbol" aria-hidden="true">.py</span><div><small>YOU’LL BUILD</small><strong>{model.mission.stages[2].tasks[0]?.title}</strong><span>Python · main.py</span></div></div>}</div>
      <StageRail mission={model.mission} run={model.run} reviewOnly={reviewOnly} />
      <div className="mission-action"><div><strong>{model.run ? `Pick up at ${model.mission.stages[model.run.stageIndex].title}` : "Begin with a clear plan"}</strong><p>{model.run ? "Your saved code, hints, and place are ready." : model.selection.reviewTaskIds.length ? "Your scheduled retrieval comes first." : "No review is due yet. Start with the mission overview."}</p></div><button className="primary" onClick={() => studio.start()}>{model.run ? reviewOnly ? "Resume review" : "Resume mission" : reviewOnly ? "Start review" : `Start ${model.mission.estimatedMinutes}-minute mission`}<span aria-hidden="true"> →</span></button></div>
    </section> : <section className="document empty-state"><span className="eyebrow">UP TO DATE</span><h2>You’ve completed the available missions.</h2><p>Your next retrieval appears when a saved skill review is due. Revisit your work in the evidence log.</p><button className="secondary" onClick={() => studio.navigate("learned")}>View your evidence</button></section>}
    <PlacementCard studio={studio} />
    <div className="dashboard-columns"><section className="document"><div className="section-heading"><h2>Your learning record</h2><button className="text-button" onClick={() => studio.navigate("learned")}>View log →</button></div>{model.evidence.length ? <ul className="skill-list">{model.evidence.map(skill => <li key={skill.skillId}><span>{skill.title}</span><span className="status-label">{skill.status}</span></li>)}</ul> : <div className="empty-copy"><span className="empty-mark" aria-hidden="true">[ ]</span><h3>Your first evidence starts here.</h3><p>No attempts saved yet. A completed lesson records exposure; independent project checks show what you can do.</p></div>}</section>
      <section className="document"><div className="section-heading"><h2>Coming back to it</h2><span className="eyebrow">REVIEW</span></div>{model.reviews.length ? <ul className="review-list">{model.reviews.map(review => <li key={review.skillId}><strong>{curriculum.skills.find(s => s.id === review.skillId)?.title}</strong><span>{formatDate(review.dueAt)} · {review.reason}</span></li>)}</ul> : <div className="empty-copy"><h3>No reviews scheduled yet.</h3><p>Reviews are scheduled from your actual learning and attempts. They’ll appear here as you work.</p></div>}</section></div>
    <p className="page-footnote">Your work stays in this browser. Reading, practice, and independent evidence are recorded separately.</p>
  </>;
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
    {mission && <p className="muted">{mission.title}{rec.blockedMissionId ? " · blocked until the repair is done" : ""}</p>}
    <p>{rec.reason}</p>
    <div className="button-row"><button className="primary" onClick={action.run}>{action.label} →</button></div>
  </section>;
}

function Lessons({ studio }: { studio: Studio }) {
  return <><PageHeading label="LESSON LIBRARY" title="Learn the pattern. Put it to work.">Each mission takes you from a worked example to a project you can explain.</PageHeading><section className="document lesson-library" aria-labelledby="library-title"><div className="library-group"><h2 id="library-title">Reliable data with Python</h2><p>Functions, validation, and useful imports</p></div>{getLibraryRows(studio.state).map((row, index) => <article className="lesson-row" key={row.mission.id}>
      <span className="lesson-index" aria-label={`Mission ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span><div className="lesson-description"><span className="status-label">{row.status}</span><h3>{row.mission.title}</h3><p>{row.mission.summary}</p><span className="artifact-label">Artifact · {row.artifact}</span>{row.blockedReason && <p className="prerequisite">{row.blockedReason}</p>}</div><div className="lesson-action"><span className="duration">{row.mission.estimatedMinutes} min</span><button className="secondary" disabled={Boolean(row.blockedReason)} onClick={() => studio.start(row.mission.id)}>{row.status === "In progress" ? "Resume mission" : row.status === "Completed" ? "Practice again" : "Open mission"}<span aria-hidden="true"> →</span></button></div>
    </article>)}</section><p className="page-footnote">The library shows the authored missions available today. Progress reflects saved mission runs.</p></>;
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
    <p className="muted">One qualitative status per skill — never a percentage. Status comes from independent evidence: project work, later retrieval in new contexts, and spaced reviews. Placement only suggests where to start; it never grants status.</p>
    {graph.map(node => <details className="evidence-entry" key={node.skillId}>
      <summary><div className="evidence-description"><h2>{node.name}</h2><p>{node.evidenceCount} evidence · {node.lastDemonstratedAt ? `last demonstrated ${formatDate(node.lastDemonstratedAt)}` : "not yet demonstrated"}</p></div><span className="status-label">{SKILL_STATUS_LABELS[node.status]}</span><span className="details-chevron" aria-hidden="true">⌄</span></summary>
      <div className="evidence-details">
        <p><strong>Prerequisites:</strong> {node.prerequisites.length ? node.prerequisites.map(p => p.name).join(", ") : "None"}</p>
        <p><strong>Next review:</strong> {node.nextReviewAt ? `${formatDate(node.nextReviewAt)} · ${node.nextReviewReason}` : "Not scheduled"}</p>
        <p>{node.readiness}</p>
        {node.placement !== "untested" && <p className="muted">Placement signal: {node.placement} — placement only, not a status.</p>}
        {node.evidenceTasks.length > 0 && <><h3>Tasks providing evidence</h3><ul className="saved-checks">{node.evidenceTasks.map(task => <li key={`${task.taskId}-${task.completedAt}`}>{task.title} · {task.kind} · {formatDate(task.completedAt)} · {task.passed ? "passed" : "needs changes"}{task.independent ? "" : " · assisted"}</li>)}</ul></>}
      </div>
    </details>)}
  </section>;
}

function Learned({ studio }: { studio: Studio }) {
  const rows = getEvidenceRows(studio.state);
  return <><PageHeading label="EVIDENCE LOG" title="Your work, with the receipts.">Saved attempts show what you tried, what passed, and how much help you used.</PageHeading><SkillGraphSection studio={studio} />{rows.length ? <section className="evidence-list" aria-label="Saved attempts">{rows.map(row => {
    const code = row.attempt.purpose !== "instruction" && row.attempt.purpose !== "reflection";
    const label = row.attempt.purpose === "instruction" ? "Lesson read" : row.attempt.purpose === "reflection" ? "Reflection saved" : row.attempt.passed ? "Passed" : row.attempt.executionOk ? "Needs changes" : "Couldn't run";
    return <details className="document evidence-entry" key={row.attempt.id}><summary><div className="evidence-date"><time dateTime={row.attempt.completedAt}>{formatDate(row.attempt.completedAt)}</time><span>{new Date(row.attempt.completedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></div><div className="evidence-description"><h2>{row.title}</h2><p>{row.attempt.purpose.replaceAll("-", " ")} · {row.assistance}</p><span>{code ? `${row.attempt.checks.filter(c => c.passed).length}/${row.attempt.checks.length} checks passed` : "Not a graded skill claim"}{row.nextReview ? ` · Next review ${formatDate(row.nextReview)}` : " · No review scheduled"}</span></div><span className={`result-label ${code ? row.attempt.passed ? "success" : "failure" : ""}`}>{label}</span><span className="details-chevron" aria-hidden="true">⌄</span></summary><div className="evidence-details"><p className="muted">{row.missionTitle}{row.attempt.duplicateOf ? " · Repeated submission; no additional mastery credit." : ""}</p>{Object.entries(row.attempt.sourceFiles).map(([file, source]) => <div key={file}><h3>{file}</h3><pre>{source}</pre></div>)}{row.attempt.response && <div><h3>Your reflection</h3><p>{row.attempt.response}</p></div>}{row.attempt.checks.length > 0 && <ul className="saved-checks">{row.attempt.checks.map(check => <li key={check.id}><strong>{check.passed ? "Passed" : "Needs changes"}: {check.name}</strong>{check.detail && <p>{check.detail}</p>}</li>)}</ul>}<p className="muted">{row.assistance}. {row.attempt.purpose === "guided-practice" ? "Guided practice does not establish independent project evidence." : row.attempt.purpose === "project" && row.attempt.passed ? "Mastery requires varied independent evidence and later retrieval." : "This is a record of this attempt only."}</p></div></details>;
  })}</section> : <section className="document large-empty"><span className="empty-mark" aria-hidden="true">[ ]</span><h2>No saved attempts yet.</h2><p>Start a mission to create your first learning record. Your code, check results, hints, and reflections will appear here.</p><button className="primary" onClick={() => studio.start()}>Start your first mission →</button></section>}</>;
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
    {run.mode === "review" ? <section className="document"><h2>Retrieval results</h2>{checks.map(row => <article key={row.attempt.id}><h3>{row.title}</h3><p>{row.attempt.passed ? "Passed" : "Needs changes"} · {row.attempt.checks.filter(c => c.passed).length} of {row.attempt.checks.length} checks passed · {row.assistance}</p><p>{row.nextReview ? `Next review: ${formatDate(row.nextReview)}` : "No review scheduled."}</p></article>)}<p>Your completed project history is unchanged.</p></section> : <><ProjectReview studio={studio} runId={run.id} actions={<><button className="primary" onClick={() => studio.navigate("learned")}>Go to What I Learned →</button><button className="secondary" onClick={() => studio.navigate("today")}>Back to Today</button></>} /><section className="document completion-record"><h2>What changed</h2><p>{curriculum.missions.find(m => m.id === run.missionId)?.title} is now Completed in Lessons.</p><ul className="saved-checks">{rows.map(row => <li key={row.attempt.id}>{row.title}: {row.assistance}{row.attempt.purpose === "instruction" || row.attempt.purpose === "reflection" ? " · saved" : row.attempt.passed ? " · passed" : " · needs changes"}</li>)}</ul><p>Skill status above comes from independent evidence. Reading, assisted practice, and reflection alone do not establish mastery.</p></section></>}
    {run.mode === "review" && <div className="button-row summary-actions"><button className="primary" onClick={() => studio.navigate("learned")}>Go to What I Learned →</button><button className="secondary" onClick={() => studio.navigate("today")}>Back to Today</button></div>}</>;
}

function Portfolio({ studio }: { studio: Studio }) {
  const projects = getPortfolioModel(studio.state);
  const completedCount = projects.reduce((n, p) => n + p.snapshots.length, 0);
  return <><PageHeading label="PORTFOLIO" title="Ship it. Prove it.">Finished portfolio projects are sealed into immutable snapshots — your source, the fixtures, the named tests, and your reflection. Download any project as a GitHub-ready zip.</PageHeading>{completedCount ? <div>{projects.map(({ project, snapshots, complete }) => {
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
        : snapshots.length > 0 && <p className="muted">Complete {missingTitles} to unlock the GitHub-ready ZIP export.</p>}
    </section>;
  })}</div> : <section className="document large-empty"><span className="empty-mark" aria-hidden="true">[ ]</span><h2>No portfolio snapshots yet.</h2><p>Complete a mission whose build project feeds a portfolio project — for example, the payments CSV mission. Its snapshot appears here the moment the mission completes.</p><button className="primary" onClick={() => studio.navigate("lessons")}>Browse missions →</button></section>}</>;
}

export function Dashboard({ studio }: { studio: Studio }) {
  return <main id="main-content" className="dashboard">{studio.route.completedRunId ? <Completion studio={studio} /> : studio.route.destination === "lessons" ? <Lessons studio={studio} /> : studio.route.destination === "learned" ? <Learned studio={studio} /> : studio.route.destination === "assessment" ? <Assessment studio={studio} /> : studio.route.destination === "portfolio" ? <Portfolio studio={studio} /> : <Today studio={studio} />}</main>;
}
