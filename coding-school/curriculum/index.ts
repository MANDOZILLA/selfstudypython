import { missions as missions1, reviewTasks as reviewTasks1 } from "./missions";
import { MISSIONS_2, MISSION_2_REVIEW_TASKS } from "./missions-2";
import { MISSIONS_BASICS_1, BASICS_1_REVIEW_TASKS } from "./missions-basics-1";
import { MISSIONS_BASICS_2, BASICS_2_REVIEW_TASKS } from "./missions-basics-2";
import { BASICS_REVIEW_TASKS } from "./review-basics";
import { skills as skillRegistry } from "./skills";

/** Course order: zero-to-programs basics, robust Python, then applied data work. */
export const MISSION_ORDER = [
  "first-steps", "making-decisions", "loops", "lists-and-strings", "functions-first", "dictionaries",
  "python-recovery", "validation-functions", "classes-objects",
  "csv-foundations", "transform-records", "json-api-normalization",
  "pandas-missing-data", "sqlite-transactions", "money-reconciliation", "http-resilience", "llm-guardrails",
] as const;

const authored = [...MISSIONS_BASICS_1, ...MISSIONS_BASICS_2, ...missions1, ...MISSIONS_2];
export const missions = MISSION_ORDER.map(id => {
  const mission = authored.find(m => m.id === id);
  if (!mission) throw new Error(`Mission ${id} is in MISSION_ORDER but not authored.`);
  return mission;
});
if (authored.length !== missions.length) throw new Error("Every authored mission must appear in MISSION_ORDER.");
export const reviewTasks = [...BASICS_REVIEW_TASKS, ...BASICS_1_REVIEW_TASKS, ...BASICS_2_REVIEW_TASKS, ...reviewTasks1, ...MISSION_2_REVIEW_TASKS];
export { DIAGNOSTIC_CORE_SKILLS, DIAGNOSTIC_ITEMS, DIAGNOSTIC_SKILLS } from "./diagnostic-items";
export type { DiagnosticItem, DiagnosticSkillId } from "./diagnostic-items";
export { PORTFOLIO_PROJECTS } from "./skills";
export type { PortfolioProjectId } from "./skills";

export const skills = skillRegistry;

// Compatibility view for the old workbench. Content comes from authored missions.
export const lessons = missions.map(mission => {
  const task = mission.stages[2].tasks[0];
  const variant = task.variants[0];
  return {
    id: mission.id, title: mission.title, skillId: mission.introducedSkillIds[0] ?? mission.revisitedSkillIds[0], estimatedMinutes: mission.estimatedMinutes,
    objectives: task.requirements.slice(0, 2), explanation: task.explanation, examples: task.examples,
    exercise: { id: variant.exerciseId, graderId: variant.graderId, starterFiles: variant.starterFiles, visibleRequirements: task.requirements, hints: task.hints },
    dailyProject: mission.summary,
  };
});
export const projects = missions.map(mission => ({ id: `project-${mission.id}`, title: mission.stages[2].tasks[0].title, skillIds: mission.stages[2].tasks[0].skillIds, objective: mission.summary }));
import { ASSESSMENTS } from "./assessments";
export { ASSESSMENTS } from "./assessments";
export type { Assessment, AssessmentTask, AssessmentTaskKind } from "./assessments";
// Backwards-compatible summary view (existing curriculum schema shape).
export const assessments: { id: string; title: string; skillIds: string[] }[] = ASSESSMENTS.map(a => ({
  id: a.id,
  title: a.title,
  skillIds: [...new Set(a.tasks.map(t => t.skillId))],
}));
