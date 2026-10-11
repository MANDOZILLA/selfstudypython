import { getProgressSummary } from "../../lib/progress";
import type { LearningState } from "../../lib/state";
import css from "./hud.module.css";
export function Hud({ state, reviewsDue = 0, checkpointsReady = 0 }: { state: LearningState; reviewsDue?: number; checkpointsReady?: number }) {
  const p = getProgressSummary(state);
  const next = p.level.next === null ? null : p.level.next - p.level.floor;
  return <section className={`hud-panel ${css.strip}`} aria-label="Progress status"><div><strong className="neon-text-violet">LV {p.level.level}</strong><span>RANK · {p.level.title}</span></div><div className={css.xp}><div className={`xp-bar ${css.bar}`}><span className="xp-bar-fill" style={{ "--fill": `${p.level.fill * 100}%` } as React.CSSProperties} /></div><span>{p.level.xp} XP · {next === null ? "MAX RANK" : `${p.level.next! - p.level.xp} to LV ${p.level.level + 1}`}</span></div><div><strong className="neon-text-amber">{p.streak.current}</strong><span>DAY STREAK</span></div><div><strong>{reviewsDue}</strong><span>REVIEWS DUE</span></div><div><strong>{checkpointsReady}</strong><span>CHECKPOINTS READY</span></div></section>;
}
