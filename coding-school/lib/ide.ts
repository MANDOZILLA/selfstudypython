// IDE project-state helpers: pure functions behind the multi-file workbench.
// The worker validates names again at the protocol boundary; these helpers
// keep the UI from ever constructing an invalid project.
import { isSafeFileName } from "../public/grading/protocol.js";

export type IdeProject = {
  /** Learner-editable source files, keyed by safe relative path. */
  files: Record<string, string>;
  /** Read-only project data (fixtures), never submitted as source. */
  fixtures: Record<string, string>;
  /** File executed on Run; must name a .py file inside files. */
  entrypoint: string;
  /** File currently open in the editor. */
  activeFile: string;
};

function cloneFiles(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([name, content]) => [name, content]));
}

/** Keep only entries whose names are safe relative paths with string content. */
export function sanitizeProjectFiles(files: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).filter(([name, content]) => isSafeFileName(name) && typeof content === "string") as [string, string][],
  );
}

/** Pick the entrypoint: the request when it names a .py file in the project,
 *  otherwise main.py, otherwise the first .py file, otherwise main.py. */
export function resolveEntrypoint(files: Record<string, string>, requested?: string): string {
  if (requested && requested.endsWith(".py") && isSafeFileName(requested) && requested in files) return requested;
  if ("main.py" in files) return "main.py";
  return Object.keys(files).sort().find(name => name.endsWith(".py")) ?? "main.py";
}

/** Learner-editable file names in a stable order. */
export function editableFiles(project: IdeProject): string[] {
  return Object.keys(project.files).sort();
}

/** Whether a name is a read-only project fixture. */
export function isFixture(name: string, project: IdeProject): boolean {
  return name in project.fixtures;
}

/** Persist the outgoing draft under the old file, then activate the target
 *  when it exists. Unknown targets keep the current file (draft still saved). */
export function switchActiveFile(project: IdeProject, name: string, currentContent: string): IdeProject {
  const files = { ...cloneFiles(project.files), [project.activeFile]: currentContent };
  return { ...project, files, activeFile: name in files ? name : project.activeFile };
}

/** Create a new empty file when the name is safe and unused. Fixture names
 *  are reserved: fixtures are read-only project data, never learner source. */
export function addProjectFile(project: IdeProject, name: string): { project: IdeProject; error?: string } {
  const trimmed = name.trim();
  if (!isSafeFileName(trimmed)) return { project, error: `“${name}” is not a safe file name. Use letters, numbers, dashes, underscores, and dots.` };
  if (trimmed in project.files) return { project, error: `“${trimmed}” already exists.` };
  if (trimmed in project.fixtures) return { project, error: `“${trimmed}” is a read-only fixture file.` };
  return { project: { ...project, files: { ...cloneFiles(project.files), [trimmed]: "" }, activeFile: trimmed } };
}

/** Delete a learner file. The entrypoint and the last remaining file are
 *  protected; deleting the active file moves the editor to the entrypoint. */
export function deleteProjectFile(project: IdeProject, name: string): { project: IdeProject; error?: string } {
  if (!(name in project.files)) return { project, error: `“${name}” is not in this project.` };
  if (name === project.entrypoint) return { project, error: `“${name}” is the entrypoint and cannot be deleted. Change the entrypoint first.` };
  if (Object.keys(project.files).length <= 1) return { project, error: "A project needs at least one file." };
  const files = cloneFiles(project.files);
  delete files[name];
  return { project: { ...project, files, activeFile: project.activeFile === name ? project.entrypoint : project.activeFile } };
}

/** Snapshot every file so a confirmed reset stays recoverable. */
export function createResetBackup(files: Record<string, string>): Record<string, string> {
  return cloneFiles(files);
}

/** Optional IDE authoring fields a task variant may carry. Kept separate
 *  from the canonical variant schema so curriculum authoring stays additive. */
export type IdeVariantExtras = { entrypoint?: string; fixtures?: Record<string, string> };

/** Build the IDE portion of a worker request: a validated entrypoint and
 *  sanitized fixtures that never shadow learner files. */
export function ideRequestExtras(variant: IdeVariantExtras, files: Record<string, string>): { entrypoint: string; fixtures: Record<string, string> } {
  const fixtures = sanitizeProjectFiles(variant.fixtures ?? {});
  for (const name of Object.keys(files)) delete fixtures[name];
  return { entrypoint: resolveEntrypoint(files, variant.entrypoint), fixtures };
}
