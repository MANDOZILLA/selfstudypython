import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Workbench } from "../app/studio/workbench";

/**
 * Authored progressive hints are no longer code-only: the curriculum ships
 * hints on instruction and explanation/reflection tasks too, and the workbench
 * must reveal them one rung at a time under the same Learning Mode and
 * assistance-accounting rules the code tasks use.
 */

function task(overrides: Record<string, unknown>) {
  return {
    id: "t-task",
    kind: "instruction",
    purpose: "instruction",
    title: "Task",
    explanation: "Do the thing.",
    requirements: ["r1"],
    examples: ["in -> out"],
    hints: ["First rung.", "Second rung."],
    variants: [{ id: "v1", exerciseId: "ex", graderId: "gr" }],
    ...overrides,
  };
}

const instructionTask = task({ id: "t-read", kind: "instruction", purpose: "instruction" });
const explanationTask = task({ id: "t-explain", kind: "explanation", purpose: "reflection" });
const codeTask = task({ id: "t-code", kind: "code", purpose: "guided" });

function studio(taskInput: object, overrides: Record<string, unknown> = {}) {
  const stage = { id: "s1", title: "Stage", estimatedMinutes: 10, tasks: [] };
  return {
    workbench: {
      mission: { id: "m1", title: "Mission", estimatedMinutes: 30, stages: [stage], summary: "" },
      run: { id: "r1", mode: "mission", stageIndex: 0, stages: [{ status: "active" }] },
      stage,
      task: taskInput,
      stageComplete: false,
      taskComplete: false,
      latestAttempt: undefined,
    },
    draft: {
      sourceFiles: { "main.py": "print(1)" },
      assistance: { hintsUsed: 0, aiAssisted: false, solutionViewed: false },
      response: "",
    },
    result: null,
    status: "Needs changes",
    busy: false,
    attemptSaved: false,
    learningMode: false,
    assistanceUsed: false,
    storageError: null,
    syncStatus: "synced",
    navigate: () => {},
    toggleLearningMode: () => {},
    continueStage: () => {},
    submitText: () => {},
    updateDraft: () => {},
    stopRun: () => {},
    ...overrides,
  } as never;
}

const render = (node: ReactElement) => renderToStaticMarkup(node);
const revealedHints = (html: string) => (html.match(/<p class="hint"/g) ?? []).length;

describe("progressive hints on non-code tasks", () => {
  it("renders the authored ladder for an instruction task", () => {
    const html = render(<Workbench studio={studio(instructionTask)} />);
    expect(html).toContain('class="hint-section"');
    expect(html).toContain("0/2 hints");
    expect(html).toContain("Reveal hint 1");
    expect(html).toContain("Record other help");
    expect(revealedHints(html)).toBe(0);
    expect(html).not.toContain("First rung."); // rungs stay hidden until revealed
    expect(html).not.toContain('class="hint"');
  });

  it("renders the authored ladder for an explanation/reflection task", () => {
    const html = render(<Workbench studio={studio(explanationTask)} />);
    expect(html).toContain('class="hint-section"');
    expect(html).toContain("0/2 hints");
    expect(html).toContain("Reveal hint 1");
    expect(html).toContain('id="reflection"');
  });

  it("keeps code-only tutoring out of reading and reflection tasks", () => {
    for (const kind of [instructionTask, explanationTask]) {
      const html = render(<Workbench studio={studio(kind)} />);
      expect(html).not.toContain("tutor-section");
      expect(html).not.toContain("Ask tutor");
    }
  });

  it("reveals one rung at a time and tracks the count", () => {
    const html = render(
      <Workbench studio={studio(instructionTask, {
        draft: {
          sourceFiles: {},
          assistance: { hintsUsed: 1, aiAssisted: false, solutionViewed: false },
          response: "",
        },
      })} />,
    );
    expect(html).toContain("1/2 hints");
    expect(html).toContain("Reveal hint 2");
    expect(revealedHints(html)).toBe(1);
    expect(html).toContain("First rung.");
    expect(html).not.toContain("Second rung.");
  });

  it("stops offering rungs once every hint is revealed", () => {
    const html = render(
      <Workbench studio={studio(explanationTask, {
        draft: {
          sourceFiles: {},
          assistance: { hintsUsed: 2, aiAssisted: false, solutionViewed: false },
          response: "",
        },
      })} />,
    );
    expect(html).toContain("2/2 hints");
    expect(html).not.toContain("Reveal hint");
    expect(revealedHints(html)).toBe(2);
  });
});

describe("Learning Mode and assistance accounting for non-code tasks", () => {
  it("hints the independent-work note instead of the ladder in Learning Mode", () => {
    const html = render(<Workbench studio={studio(instructionTask, { learningMode: true })} />);
    expect(html).toContain("independent-note");
    expect(html).toContain("Hints and solutions stay hidden");
    expect(html).not.toContain('class="hint-section"');
    expect(html).not.toContain("Reveal hint");
    expect(html).not.toContain("Record other help");
  });

  it("keeps the ladder visible once this task is already recorded as assisted", () => {
    const html = render(<Workbench studio={studio(instructionTask, {
      learningMode: true,
      assistanceUsed: true,
      draft: {
        sourceFiles: {},
        assistance: { hintsUsed: 1, aiAssisted: false, solutionViewed: false },
        response: "",
      },
    })} />);
    expect(html).not.toContain("independent-note");
    expect(html).toContain('class="hint-section"');
    expect(html).toContain("1/2 hints");
  });

  it("still offers the recorded-help disclosure on reading tasks", () => {
    const html = render(<Workbench studio={studio(instructionTask)} />);
    expect(html).toContain("I used external AI assistance");
    expect(html).toContain("I viewed a solution");
  });

  it("leaves code tasks with their tutor alongside the same ladder", () => {
    const html = render(<Workbench studio={studio(codeTask)} />);
    expect(html).toContain('class="hint-section"');
    expect(html).toContain("Ask tutor");
    expect(html).toContain("Reveal hint 1");
  });

  it("hides the tutor from code tasks that are still independent", () => {
    const html = render(<Workbench studio={studio(codeTask, { learningMode: true })} />);
    expect(html).toContain("independent-note");
    expect(html).not.toContain("Ask tutor");
    expect(html).not.toContain('class="hint-section"');
  });
});
