import { useState } from "react";
import { destinations } from "../../lib/studio";
import type { Studio } from "./use-studio";

export function Navigation({ studio }: { studio: Studio }) {
  const [open, setOpen] = useState(false);
  return <aside className={`navigation${open ? " menu-open" : ""}`}>
    <a className="brand" href="#today" onClick={event => { event.preventDefault(); studio.navigate("today"); setOpen(false); }} aria-label="Workbench School — Today">
      <span className="brand-mark" aria-hidden="true">w<span>_</span></span><span>Workbench<small>School</small></span>
    </a>
    <button className="mobile-menu" aria-expanded={open} aria-controls="main-navigation" onClick={() => setOpen(!open)}>{open ? "Close menu" : "Navigate"}<span aria-hidden="true">{open ? " ×" : " ☰"}</span></button>
    <nav id="main-navigation" aria-label="Main navigation">
      {destinations.map((destination, i) => <a key={destination.id} href={`#${destination.id}`} aria-current={!studio.route.runId && studio.route.destination === destination.id ? "page" : undefined} onClick={event => { event.preventDefault(); studio.navigate(destination.id); setOpen(false); }}>
        <span className="nav-icon" aria-hidden="true">{["◫", "▤", "≡", "◇"][i]}</span>{destination.label}
      </a>)}
    </nav>
    <div className="nav-note"><span className="eyebrow">YOUR CODING PRACTICE</span><p>Build something useful.<br />Keep the evidence.</p><span className="local-note">{!studio.ready ? "Opening local database" : studio.storageError ? "Save needs attention" : studio.saving ? "Saving your work…" : "Stored on this computer"}</span>{studio.ready && !studio.importPending && !studio.recoveryRaw && <button className="text-button" onClick={studio.exportBackup}>Export backup</button>}</div>
  </aside>;
}
