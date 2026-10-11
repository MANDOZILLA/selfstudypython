import type { Achievement } from "../../lib/progress";
import css from "./achievements.module.css";
export function Achievements({ items }: { items: Achievement[] }) { return <section className="document"><h2>Achievements</h2><div className={css.grid}>{items.map(a => <article className={`hud-panel ${css.plaque} ${a.unlocked ? css.unlocked : css.locked}`} key={a.id} aria-label={`${a.title}: ${a.unlocked ? "unlocked" : "locked"}`}><span>{a.glyph}</span><h3>{a.title}</h3><p>{a.description}</p></article>)}</div></section>; }
