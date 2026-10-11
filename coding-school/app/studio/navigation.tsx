import { useState } from "react";
import { destinations } from "../../lib/studio";
import { getProgressSummary } from "../../lib/progress";
import type { Studio } from "./use-studio";
import { ThemeToggle } from "./theme";
function syncLabel(status: Studio["syncStatus"]): string { switch(status){case "booting":case "saving":return "saving";case "synced":return "saved";case "offline":return "offline";case "conflict":return "conflict";} }
export function Navigation({studio}:{studio:Studio}) { const [open,setOpen]=useState(false); const progress=getProgressSummary(studio.state); const labels=["HOME","MISSIONS","SKILL TREE","CHECKPOINTS","PORTFOLIO"]; return <aside className={`navigation${open?" menu-open":""}`}>
<a className="brand" href="#today" aria-label="snakepit home" onClick={e=>{e.preventDefault();studio.navigate("today");setOpen(false);}}><span className="brand-mark glitch">snakepit<span className="caret">_</span></span></a>
<nav id="main-navigation" aria-label="Main navigation">{destinations.map((d,i)=><a key={d.id} href={`#${d.id}`} aria-current={!studio.route.runId&&studio.route.destination===d.id?"page":undefined} onClick={e=>{e.preventDefault();studio.navigate(d.id);setOpen(false);}}><span aria-hidden="true">{studio.route.destination===d.id?">":" "}</span> [{i+1}] {labels[i]}</a>)}</nav>
<div className="nav-controls"><button className="mobile-menu" aria-expanded={open} aria-controls="main-navigation" onClick={()=>setOpen(!open)}>{open?"Close menu":"Menu"}</button><ThemeToggle/></div>
<section className="nav-hud hud-panel" aria-label="Your progress"><strong>LV {progress.level.level} · {progress.level.title}</strong><span>{progress.xp} XP</span><div className="xp-bar"><span className="xp-bar-fill" style={{"--fill":`${progress.level.fill*100}%`} as React.CSSProperties}/></div><span className="neon-text-amber">◆ {progress.streak.current}-day streak</span></section>
<div className="nav-note"><span className="local-note" role="status"><i aria-hidden="true">●</i> {syncLabel(studio.syncStatus)}</span></div></aside>; }
