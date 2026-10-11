import { getProgressSummary } from "../../lib/progress";
import type { LearningState } from "../../lib/state";
import css from "./hud.module.css";
export function Hud({ state }: { state: LearningState }) {
  const p = getProgressSummary(state);
  const toNext = p.level.next === null ? 0 : p.level.next - p.xp;
  return <section className={`hud-panel ${css.strip}`} aria-label="Progress status"><div><strong className="neon-text-violet">LV {p.level.level}</strong><span>{p.level.title}</span></div><div><span>{p.xp} XP · {toNext} to next rank</span><div className={`xp-bar ${css.bar}`}><span className="xp-bar-fill" style={{ "--fill": `${p.level.fill * 100}%` } as React.CSSProperties} /></div></div><div><strong className="neon-text-amber">◆ {p.streak.current}</strong><span>-day streak</span></div></section>;
}
