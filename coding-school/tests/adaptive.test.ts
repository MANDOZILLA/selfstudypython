import { describe, expect, it } from "vitest";
import { chooseDiagnosticPrompt, type DiagnosticPrompt } from "../lib/adaptive";

describe("diagnostic selection", () => {
  const prompts: DiagnosticPrompt[] = [
    { id: "loops-q1", skillId: "python-loops", difficulty: 1, kind: "concept" },
    { id: "loops-code", skillId: "python-loops", difficulty: 2, kind: "coding" },
    { id: "loops-q2", skillId: "python-loops", difficulty: 3, kind: "concept" },
    { id: "errors-q1", skillId: "exceptions", difficulty: 1, kind: "concept" },
  ];

  it("moves to an untested skill after confident varied evidence", () => {
    const next = chooseDiagnosticPrompt(prompts, [
      { promptId: "loops-q1", skillId: "python-loops", correct: true },
      { promptId: "loops-code", skillId: "python-loops", correct: true },
    ]);

    expect(next?.skillId).toBe("exceptions");
  });

  it("continues probing a skill when its evidence is uncertain", () => {
    const next = chooseDiagnosticPrompt(prompts, [
      { promptId: "loops-q1", skillId: "python-loops", correct: false },
    ]);

    expect(next?.id).toBe("loops-code");
  });
});
