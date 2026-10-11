"use client";
import { useMemo, useState } from "react";
import { buildSkillGraph, type GraphSkillStatus } from "../../lib/skill-graph";
import type { LearningState } from "../../lib/state";
import css from "./skill-tree.module.css";

const labels: Record<GraphSkillStatus, string> = {
  untested: "Untested", "needs-practice": "Needs practice", "working-evidence": "Working evidence",
  "demonstrated-in-project": "Demonstrated in project", "demonstrated-again-later": "Demonstrated again later", mastered: "Mastered",
};
const lit = (status: GraphSkillStatus) => status === "mastered" || status.startsWith("demonstrated-");

/** Splits a label into at most two lines on word boundaries; the second line is ellipsized. */
function wrapLabel(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const cut = text.lastIndexOf(" ", max);
  const first = cut > 0 ? text.slice(0, cut) : text.slice(0, max);
  const rest = text.slice(first.length).trim();
  return [first, rest.length > max ? `${rest.slice(0, max - 1)}…` : rest];
}

export function SkillTree({ state }: { state: LearningState }) {
  const graph = buildSkillGraph(state);
  const [id, setId] = useState(graph[0]?.skillId);
  const selected = graph.find(n => n.skillId === id);
  const layout = useMemo(() => {
    const byId = new Map(graph.map(node => [node.skillId, node]));
    const depths = new Map<string, number>();
    const depthOf = (skillId: string, seen = new Set<string>()): number => {
      if (depths.has(skillId)) return depths.get(skillId)!;
      if (seen.has(skillId)) return 0;
      const node = byId.get(skillId);
      if (!node?.prerequisites.length) { depths.set(skillId, 0); return 0; }
      const chain = new Set(seen).add(skillId);
      const depth = 1 + Math.max(...node.prerequisites.map(prereq => depthOf(prereq.skillId, chain)));
      depths.set(skillId, depth);
      return depth;
    };
    graph.forEach(node => depthOf(node.skillId));
    const columns = new Map<number, typeof graph>();
    graph.forEach(node => {
      const depth = depths.get(node.skillId) ?? 0;
      columns.set(depth, [...(columns.get(depth) ?? []), node]);
    });
    const maxRows = Math.max(1, ...[...columns.values()].map(nodes => nodes.length));
    const width = Math.max(820, (Math.max(...depths.values(), 0) + 1) * 270 + 40);
    const height = Math.max(380, maxRows * 116 + 45);
    const positions = new Map<string, { x: number; y: number }>();
    columns.forEach((nodes, depth) => nodes.forEach((node, row) => positions.set(node.skillId, { x: 30 + depth * 270, y: 30 + row * 116 })));
    return { width, height, positions };
  }, [graph]);
  return <section className={`document ${css.section}`} aria-labelledby="skill-tree-title">
    <div className="section-heading"><h2 id="skill-tree-title">Skill tree</h2><span className="eyebrow">EVIDENCE MAP</span></div>
    <p className="muted">Skill status comes from evidence over time. XP measures effort and never sets mastery.</p>
    <div className={css.scroller} role="region" aria-label="Scrollable skill tree">
      <svg className={css.svg} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label="Skills arranged by prerequisite depth">
        {graph.flatMap(node => node.prerequisites.map(prereq => {
          const from = layout.positions.get(prereq.skillId); const to = layout.positions.get(node.skillId);
          if (!from || !to) return [];
          const mid = (from.x + 220 + to.x) / 2;
          return <path key={`${prereq.skillId}-${node.skillId}`} className={`${css.edge} ${lit(byStatus(graph, prereq.skillId)) ? css.edgeLit : ""}`} d={`M ${from.x + 220} ${from.y + 42} C ${mid} ${from.y + 42}, ${mid} ${to.y + 42}, ${to.x} ${to.y + 42}`} />;
        }))}
        {graph.map(node => {
          const pos = layout.positions.get(node.skillId)!;
          const statusClass = node.status === "untested" ? css.untested : node.status === "needs-practice" ? css.needsPractice : node.status === "mastered" ? css.mastered : css.evidence;
          return <g key={node.skillId} className={`${css.node} ${statusClass} ${selected?.skillId === node.skillId ? css.selected : ""}`} role="button" tabIndex={0} aria-label={`${node.name}: ${labels[node.status]}`} aria-pressed={selected?.skillId === node.skillId} onClick={() => setId(node.skillId)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setId(node.skillId); } }} transform={`translate(${pos.x} ${pos.y})`}>
            <rect width="220" height="84" rx="4" />
            <text x="10" y="24">{wrapLabel(node.name, 27).map((line, i) => <tspan key={i} x="10" dy={i ? 16 : 0}>{line}</tspan>)}</text>
            <text className={css.status} x="10" y="68">{labels[node.status]}</text>
          </g>;
        })}
      </svg>
    </div>
    {selected && <aside className={css.detail} aria-live="polite"><h3>{selected.name}</h3><p>{selected.readiness}</p><p><strong>Prerequisites:</strong> {selected.prerequisites.map(p => p.name).join(", ") || "None"}</p><p><strong>Next review:</strong> {selected.nextReviewAt?.slice(0, 10) ?? "Not scheduled"}</p>{selected.evidenceTasks.length > 0 && <><h4>Evidence tasks</h4><ul>{selected.evidenceTasks.map((task, i) => <li key={`${task.taskId}-${i}`}>{task.title} · {task.passed ? "passed" : "needs work"}</li>)}</ul></>}</aside>}
    <details><summary>About mastery</summary><p>Mastery needs independent evidence across varied tasks and later practice. Placement alone never grants status.</p></details>
  </section>;
}

function byStatus(graph: ReturnType<typeof buildSkillGraph>, skillId: string): GraphSkillStatus {
  return graph.find(node => node.skillId === skillId)?.status ?? "untested";
}
