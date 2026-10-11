import { useState } from "react";
import { buildSkillGraph } from "../../lib/skill-graph";
import type { LearningState } from "../../lib/state";
import css from "./skill-tree.module.css";
export function SkillTree({ state }: { state: LearningState }) {
  const graph = buildSkillGraph(state); const [id, setId] = useState(graph[0]?.skillId); const node = graph.find(n => n.skillId === id);
  const label = (s: string) => s.replaceAll("-", " ");
  return <section className="document"><h2>Skill tree</h2><p>Skill status comes from evidence over time. XP is for effort and never sets mastery.</p><div className={`${css.tree} skill-tree`} role="group" aria-label="Skill tree">{graph.map(n => <button key={n.skillId} className={`skill-node skill-${n.status}`} aria-label={`${n.name}: ${label(n.status)}`} aria-pressed={n.skillId === id} onClick={() => setId(n.skillId)}>{n.name}<small>{label(n.status)}</small></button>)}</div>{node && <aside className={css.detail} aria-live="polite"><h3>{node.name}</h3><p>{node.readiness}</p><p>Prerequisites: {node.prerequisites.map(p => p.name).join(", ") || "None"}</p><p>Next review: {node.nextReviewAt || "Not scheduled"}</p><ul>{node.evidenceTasks.map((t, i) => <li key={`${t.taskId}-${i}`}>{t.title} · {t.passed ? "passed" : "needs work"}</li>)}</ul></aside>}<details><summary>About mastery</summary><p>Mastery needs independent evidence across varied tasks and later practice. Placement alone never grants status.</p></details></section>;
}
