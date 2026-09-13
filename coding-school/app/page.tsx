"use client";

import { Dashboard } from "./studio/dashboard";
import { Navigation } from "./studio/navigation";
import { Workbench } from "./studio/workbench";
import { useStudio } from "./studio/use-studio";

export default function Home() {
  const studio = useStudio();
  return <div className={`studio-shell${studio.workbench ? " in-workbench" : ""}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <Navigation studio={studio} />
    <div className="studio-content">
      {studio.storageError && <div className="storage-error" role="alert"><div><strong>{studio.ready ? "Changes could not be saved." : "Saved work could not be loaded."}</strong><p>{studio.storageError}</p></div>{studio.recoveryRaw === null && <div className="button-row"><button className="secondary" onClick={studio.retrySave}>{studio.ready ? "Retry saving" : "Retry loading"}</button>{studio.ready && <button className="secondary" onClick={studio.exportBackup}>Export pending work</button>}</div>}</div>}
      {!studio.ready ? <main className="dashboard" aria-busy={!studio.storageError}><span className="eyebrow">WORKBENCH SCHOOL</span><h1>{studio.storageError ? "Your saved work is unavailable" : "Opening your studio…"}</h1>{studio.storageError && <p>The local server has not loaded your learning record. Retry when it is available.</p>}</main> : studio.recoveryRaw !== null ? <main id="main-content" className="dashboard"><section className="document"><h1 id="page-title" tabIndex={-1}>Recover your saved work</h1><p>The saved data is unreadable. Its original contents remain untouched. Export a copy for recovery, retry after repairing browser storage, or start fresh with a local backup.</p><div className="button-row"><button className="primary" onClick={studio.exportRecovery}>Export original data</button><button className="secondary" onClick={studio.retryRecovery}>Retry recovery</button><button className="secondary" onClick={studio.resetRecovery}>Back up data & reset</button></div></section></main> : studio.importPending ? <main id="main-content" className="dashboard"><section className="document"><h1 id="page-title" tabIndex={-1}>Bring your saved work into this studio</h1><p>This browser has an existing learning record. Import its missions, code, and attempts into your local SQLite database. A recoverable browser backup stays available.</p><div className="button-row"><button className="primary" onClick={studio.importLegacy}>Import browser work</button><button className="secondary" onClick={studio.startEmpty}>Start empty · keep browser copy</button></div></section></main> : studio.workbench ? <Workbench key={`${studio.workbench.run.id}/${studio.workbench.stage.id}/${studio.workbench.task?.id ?? "overview"}`} studio={studio} /> : <Dashboard studio={studio} />}
    </div>
  </div>;
}
