// IDE project-state helpers: multi-file drafts, active file, entrypoint,
// fixtures, safe file creation/deletion, and reset backups.
import { describe, expect, it } from "vitest";
import {
  addProjectFile,
  createResetBackup,
  deleteProjectFile,
  editableFiles,
  ideRequestExtras,
  isFixture,
  resolveEntrypoint,
  sanitizeProjectFiles,
  switchActiveFile,
  type IdeProject,
} from "../lib/ide";

const BASE: IdeProject = {
  files: { "main.py": "print(1)", "helpers.py": "X = 1" },
  fixtures: { "data/input.csv": "a,b\n1,2\n" },
  entrypoint: "main.py",
  activeFile: "main.py",
};

describe("sanitizeProjectFiles", () => {
  it("keeps safe names with string content and drops everything else", () => {
    const cleaned = sanitizeProjectFiles({
      "main.py": "print(1)",
      "../../evil.py": "x",
      "notes.txt": "hi",
      "bad": 42,
      "": "empty",
    });
    expect(cleaned).toEqual({ "main.py": "print(1)", "notes.txt": "hi" });
  });
});

describe("resolveEntrypoint", () => {
  it("prefers the requested entrypoint when it exists and is a python file", () => {
    expect(resolveEntrypoint(BASE.files, "helpers.py")).toBe("helpers.py");
  });
  it("falls back to main.py when the request is missing or not a python file", () => {
    expect(resolveEntrypoint(BASE.files, undefined)).toBe("main.py");
    expect(resolveEntrypoint(BASE.files, "nope.py")).toBe("main.py");
    expect(resolveEntrypoint(BASE.files, "data.txt")).toBe("main.py");
  });
  it("falls back to the first python file when main.py is absent", () => {
    expect(resolveEntrypoint({ "b.py": "", "a.py": "" }, undefined)).toBe("a.py");
  });
  it("returns main.py when there are no files at all", () => {
    expect(resolveEntrypoint({}, undefined)).toBe("main.py");
  });
});

describe("editableFiles and isFixture", () => {
  it("lists learner files sorted, excluding fixtures", () => {
    expect(editableFiles(BASE)).toEqual(["helpers.py", "main.py"]);
  });
  it("identifies fixture files", () => {
    expect(isFixture("data/input.csv", BASE)).toBe(true);
    expect(isFixture("main.py", BASE)).toBe(false);
  });
});

describe("switchActiveFile", () => {
  it("persists the outgoing draft under the old file and activates the new one", () => {
    const next = switchActiveFile(BASE, "helpers.py", "print(2)");
    expect(next.files["main.py"]).toBe("print(2)");
    expect(next.activeFile).toBe("helpers.py");
    expect(next.entrypoint).toBe("main.py");
  });
  it("keeps the current file when the target does not exist", () => {
    const next = switchActiveFile(BASE, "missing.py", "print(2)");
    expect(next.activeFile).toBe("main.py");
    expect(next.files["main.py"]).toBe("print(2)");
  });
});

describe("addProjectFile", () => {
  it("adds a safe new python file and activates it", () => {
    const { project, error } = addProjectFile(BASE, "utils.py");
    expect(error).toBeUndefined();
    expect(project.files["utils.py"]).toBe("");
    expect(project.activeFile).toBe("utils.py");
  });
  it("rejects unsafe names, collisions with files, and collisions with fixtures", () => {
    expect(addProjectFile(BASE, "../evil.py").error).toMatch(/safe/i);
    expect(addProjectFile(BASE, "main.py").error).toMatch(/exists/i);
    expect(addProjectFile(BASE, "data/input.csv").error).toMatch(/fixture/i);
  });
});

describe("deleteProjectFile", () => {
  it("deletes a non-entrypoint file and moves the active file to the entrypoint", () => {
    const withActive = { ...BASE, activeFile: "helpers.py" };
    const { project, error } = deleteProjectFile(withActive, "helpers.py");
    expect(error).toBeUndefined();
    expect(project.files["helpers.py"]).toBeUndefined();
    expect(project.activeFile).toBe("main.py");
  });
  it("refuses to delete the entrypoint or the last file", () => {
    expect(deleteProjectFile(BASE, "main.py").error).toMatch(/entrypoint/i);
    const single: IdeProject = { files: { "main.py": "" }, fixtures: {}, entrypoint: "main.py", activeFile: "main.py" };
    expect(deleteProjectFile(single, "main.py").error).toBeTruthy();
  });
});

describe("ideRequestExtras", () => {
  it("resolves the authored entrypoint and sanitizes fixtures", () => {
    const extras = ideRequestExtras(
      { entrypoint: "helpers.py", fixtures: { "data/input.csv": "a", "../evil": "x", "main.py": "shadow" } },
      BASE.files,
    );
    expect(extras.entrypoint).toBe("helpers.py");
    expect(extras.fixtures).toEqual({ "data/input.csv": "a" });
  });
  it("defaults the entrypoint to main.py with no authoring", () => {
    expect(ideRequestExtras({}, BASE.files)).toEqual({ entrypoint: "main.py", fixtures: {} });
  });
});

describe("createResetBackup", () => {
  it("captures a snapshot that later edits cannot mutate", () => {
    const backup = createResetBackup(BASE.files);
    const edited = { ...BASE.files, "main.py": "changed" };
    expect(backup["main.py"]).toBe("print(1)");
    expect(edited["main.py"]).toBe("changed");
  });
});
