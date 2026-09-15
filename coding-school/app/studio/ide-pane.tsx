"use client";

import Editor from "@monaco-editor/react";
import { useMemo, useState } from "react";
import type { Studio } from "./use-studio";
import {
  addProjectFile, createResetBackup, deleteProjectFile, editableFiles, resolveEntrypoint, sanitizeProjectFiles,
  type IdeProject, type IdeVariantExtras,
} from "../../lib/ide";

function sessionKey(taskId: string, name: string) {
  return `coding-school:ide:${taskId}:${name}`;
}
function readSession(key: string): string | null {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}
function writeSession(key: string, value: string) {
  try { window.sessionStorage.setItem(key, value); } catch { /* private mode: the draft itself still persists */ }
}
function removeSession(key: string) {
  try { window.sessionStorage.removeItem(key); } catch { /* ignore */ }
}

/** Multi-file IDE: file tabs and tree, per-file drafts, entrypoint picker,
 *  fixture viewer, confirmed reset with a recoverable backup, and separate
 *  Run (execute) / Run checks actions. Remount per task via key. */
export function IdePane({ studio, onAfterRun }: { studio: Studio; onAfterRun?: () => void }) {
  const { workbench, draft } = studio;
  const task = workbench?.task;
  const variant = task?.variants[0];
  const runId = workbench?.run.id ?? "";
  const taskId = task?.id ?? "";
  const [plainEditor, setPlainEditor] = useState(false);
  const [showTree, setShowTree] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [viewingFixture, setViewingFixture] = useState<string | null>(null);
  const [entrypointOverride, setEntrypointOverride] = useState<string | null>(() => readSession(sessionKey(taskId, "entrypoint")));
  const [activeFile, setActiveFile] = useState<string | null>(() => readSession(sessionKey(taskId, "active")));
  const [backup, setBackup] = useState<Record<string, string> | null>(() => {
    try {
      const raw = readSession(sessionKey(taskId, "backup"));
      return raw ? sanitizeProjectFiles(JSON.parse(raw)) : null;
    } catch { return null; }
  });

  const authoredEntrypoint = (variant as IdeVariantExtras | undefined)?.entrypoint;
  const authoredFixtures = (variant as IdeVariantExtras | undefined)?.fixtures;
  const project: IdeProject = useMemo(() => {
    const files = sanitizeProjectFiles(draft?.sourceFiles ?? {});
    const fixtures = sanitizeProjectFiles(authoredFixtures ?? {});
    for (const name of Object.keys(files)) delete fixtures[name];
    const entrypoint = resolveEntrypoint(files, entrypointOverride ?? authoredEntrypoint);
    const names = Object.keys(files).sort();
    const active = activeFile && activeFile in files ? activeFile : entrypoint in files ? entrypoint : names[0] ?? "main.py";
    return { files, fixtures, entrypoint, activeFile: active };
  }, [draft?.sourceFiles, entrypointOverride, activeFile, authoredEntrypoint, authoredFixtures]);

  const names = editableFiles(project);
  const fixtureNames = Object.keys(project.fixtures).sort();
  const pythonFiles = names.filter(name => name.endsWith(".py"));

  function activate(name: string) {
    setViewingFixture(null);
    setActiveFile(name);
    writeSession(sessionKey(taskId, "active"), name);
  }
  function editActiveFile(value: string) {
    if (!draft) return;
    studio.updateDraft({ sourceFiles: { ...project.files, [project.activeFile]: value } });
  }
  function changeEntrypoint(name: string) {
    setEntrypointOverride(name);
    writeSession(sessionKey(taskId, "entrypoint"), name);
  }
  function submitAddFile() {
    if (!draft) return;
    const { project: next, error } = addProjectFile(project, newFileName);
    setFileError(error ?? null);
    if (error) return;
    studio.updateDraft({ sourceFiles: { ...project.files, [next.activeFile]: "" } });
    setNewFileName("");
    activate(next.activeFile);
  }
  function submitDeleteFile(name: string) {
    if (!draft) return;
    const { project: next, error } = deleteProjectFile(project, name);
    setFileError(error ?? null);
    if (error) return;
    const files = { ...project.files };
    delete files[name];
    studio.updateDraft({ sourceFiles: files });
    setConfirmingDelete(null);
    if (next.activeFile !== project.activeFile) activate(next.activeFile);
  }
  function submitReset() {
    if (!draft) return;
    const snapshot = createResetBackup(project.files);
    setBackup(snapshot);
    writeSession(sessionKey(taskId, "backup"), JSON.stringify(snapshot));
    const starter = sanitizeProjectFiles(variant?.starterFiles ?? { "main.py": "" });
    studio.updateDraft({ sourceFiles: starter });
    setEntrypointOverride(null);
    removeSession(sessionKey(taskId, "entrypoint"));
    setConfirmingReset(false);
    setFileError(null);
    activate(resolveEntrypoint(starter, authoredEntrypoint));
  }
  function restoreBackup() {
    if (!draft || !backup) return;
    studio.updateDraft({ sourceFiles: { ...backup } });
    setBackup(null);
    removeSession(sessionKey(taskId, "backup"));
    setFileError(null);
    activate(resolveEntrypoint(backup, authoredEntrypoint));
  }
  function onFileTabKeyDown(event: React.KeyboardEvent, name: string) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = names.indexOf(name);
    const next = event.key === "ArrowRight" ? names[(index + 1) % names.length]
      : event.key === "ArrowLeft" ? names[(index - 1 + names.length) % names.length]
      : event.key === "Home" ? names[0] : names[names.length - 1];
    activate(next);
    requestAnimationFrame(() => document.getElementById(`file-tab-${names.indexOf(next)}`)?.focus());
  }

  const continueLabel = workbench?.stageComplete
    ? workbench.run.mode === "review" ? "Finish review"
    : (() => { const next = workbench.mission.stages[workbench.run.stageIndex + 1]; return next ? `Continue to ${next.title}` : "Finish mission"; })()
    : "Continue to next task";
  const viewing = viewingFixture !== null;
  const editorValue = viewing ? project.fixtures[viewingFixture] ?? "" : project.files[project.activeFile] ?? "";

  return <>
    <div className="editor-toolbar ide-toolbar">
      <button className="text-button" onClick={() => setShowTree(!showTree)} aria-expanded={showTree} aria-controls="ide-file-tree">
        {showTree ? "Hide files" : "Files"}
      </button>
      <div className="file-tabs" role="tablist" aria-label="Project files">
        {names.map((name, index) => <button key={name} id={`file-tab-${index}`} role="tab"
          aria-selected={name === project.activeFile && !viewing} tabIndex={name === project.activeFile && !viewing ? 0 : -1}
          className={name === project.activeFile && !viewing ? "file-tab active" : "file-tab"}
          onClick={() => activate(name)} onKeyDown={event => onFileTabKeyDown(event, name)}>
          {name}{name === project.entrypoint && <span className="entrypoint-dot" title="Entrypoint: this file runs first" aria-label=" (entrypoint)"> ●</span>}
        </button>)}
      </div>
      <label className="entrypoint-picker">Run from
        <select value={project.entrypoint} onChange={event => changeEntrypoint(event.target.value)} aria-label="Entrypoint file">
          {pythonFiles.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <button className="text-button" onClick={() => setPlainEditor(!plainEditor)}>{plainEditor ? "Use code editor" : "Use plain text"}</button>
    </div>
    {showTree && <div className="ide-file-tree" id="ide-file-tree">
      <div className="tree-section"><h3>Source files</h3><ul>
        {names.map(name => <li key={name}><button className={name === project.activeFile && !viewing ? "tree-item active" : "tree-item"} onClick={() => activate(name)}>
          <span aria-hidden="true">{name.endsWith(".py") ? "🐍" : "📄"}</span> {name}
          {name === project.entrypoint && <span className="badge">entrypoint</span>}
        </button>{confirmingDelete === name
          ? <span className="inline-confirm"><button className="text-button danger" onClick={() => submitDeleteFile(name)}>Confirm delete</button><button className="text-button" onClick={() => setConfirmingDelete(null)}>Cancel</button></span>
          : <button className="text-button danger" onClick={() => setConfirmingDelete(name)} aria-label={`Delete ${name}`}>Delete</button>}</li>)}
      </ul><form className="add-file" onSubmit={event => { event.preventDefault(); submitAddFile(); }}>
        <label htmlFor="new-file-name" className="visually-hidden">New file name</label>
        <input id="new-file-name" value={newFileName} onChange={event => setNewFileName(event.target.value)} placeholder="new-file.py" spellCheck={false} />
        <button className="secondary" type="submit">Add file</button>
      </form></div>
      {fixtureNames.length > 0 && <div className="tree-section"><h3>Project data (read-only)</h3><ul>
        {fixtureNames.map(name => <li key={name}><button className={name === viewingFixture ? "tree-item active" : "tree-item"} onClick={() => { setViewingFixture(name); }}>
          <span aria-hidden="true">🗂️</span> {name} <span className="badge">fixture</span>
        </button></li>)}
      </ul></div>}
      {fileError && <p className="file-error" role="alert">{fileError}</p>}
    </div>}
    <div className="editor-canvas">
      {viewing ? <div className="fixture-view">
        <p className="fixture-banner"><span className="badge">fixture</span> {viewingFixture} is read-only project data. <button className="text-button" onClick={() => setViewingFixture(null)}>Back to {project.activeFile}</button></p>
        <pre aria-label={`Fixture ${viewingFixture}`}>{editorValue || "(empty)"}</pre>
      </div> : plainEditor
        ? <textarea className="plain-editor" aria-label={`Python code in ${project.activeFile}`} value={editorValue} spellCheck={false} onChange={event => editActiveFile(event.target.value)} />
        : <Editor path={`${runId}/${taskId}/${project.activeFile}`} language="python" theme="light" value={editorValue}
          onChange={value => editActiveFile(value ?? "")}
          loading={<p className="editor-loading">Loading code editor… You can also choose “Use plain text”.</p>}
          options={{ minimap: { enabled: false }, fontFamily: "IBM Plex Mono, monospace", fontSize: 13, lineHeight: 22, padding: { top: 16 }, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on", tabSize: 4, ariaLabel: `Python code editor for ${project.activeFile}. Press Escape then Tab to leave the editor.`, accessibilitySupport: "on", fixedOverflowWidgets: true }}
          onMount={editor => { editor.onKeyDown(event => { if (event.code === "Escape") { event.preventDefault(); document.getElementById("run-checks")?.focus(); } }); }} />}
    </div>
    <div className="editor-actions">
      <button id="run-checks" className="primary" disabled={studio.busy} onClick={() => { studio.runChecks(project.entrypoint); onAfterRun?.(); }}>{studio.busy ? studio.status : "Run checks"}<span aria-hidden="true"> ▷</span></button>
      <button id="run-code" className="secondary" disabled={studio.busy} onClick={() => { studio.runCode(project.entrypoint); onAfterRun?.(); }}>{studio.busy && studio.status === "Running code" ? studio.status : "Run"}<span aria-hidden="true"> ▶</span></button>
      {studio.busy
        ? <button className="secondary desktop-stop" onClick={studio.stopRun}>Stop run</button>
        : workbench?.taskComplete && !studio.storageError && <button className="secondary continue-button" onClick={studio.continueStage}>{continueLabel} →</button>}
      <span className="save-indicator" role="status">{studio.storageError ? "Not saved" : "Draft saved locally"}</span>
    </div>
    <div className="ide-danger-zone">
      {confirmingReset ? <p className="inline-confirm" role="alert">Reset all files to the task starter? Your current draft is kept as a recoverable backup.
        <button className="secondary danger" onClick={submitReset}>Reset files</button>
        <button className="text-button" onClick={() => setConfirmingReset(false)}>Cancel</button></p>
        : <button className="text-button danger" onClick={() => setConfirmingReset(true)}>Reset files</button>}
      {backup && !confirmingReset && <button className="text-button" onClick={restoreBackup}>Restore previous draft</button>}
    </div>
    <p className="editor-shortcut">Press Esc to leave the editor · Your code is saved as you type · ● marks the entrypoint</p>
  </>;
}
