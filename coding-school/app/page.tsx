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
      {studio.storageError && <div className="storage-error" role="alert"><div><strong>Changes could not be saved.</strong><p>{studio.storageError}</p></div>{studio.recoveryRaw === null && <button className="secondary" onClick={studio.retrySave}>Retry saving</button>}</div>}
      {!studio.ready ? <main className="dashboard" aria-busy="true"><span className="eyebrow">WORKBENCH SCHOOL</span><h1>Opening your studio…</h1></main> : studio.recoveryRaw !== null ? <main id="main-content" className="dashboard"><section className="document"><h1 id="page-title" tabIndex={-1}>Recover your saved work</h1><p>The saved data is unreadable. Its original contents remain untouched. Export a copy for recovery, retry after repairing browser storage, or start fresh with a local backup.</p><div className="button-row"><button className="primary" onClick={studio.exportRecovery}>Export original data</button><button className="secondary" onClick={studio.retryRecovery}>Retry recovery</button><button className="secondary" onClick={studio.resetRecovery}>Back up data & reset</button></div></section></main> : studio.workbench ? <Workbench key={`${studio.workbench.run.id}/${studio.workbench.stage.id}/${studio.workbench.task?.id ?? "overview"}`} studio={studio} /> : <Dashboard studio={studio} />}
    </div>
  </div>;
}
