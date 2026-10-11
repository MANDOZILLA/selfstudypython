import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/tutor/route";
import { TutorPanel, TutorResponseView } from "../app/studio/tutor-panel";
import {
  deterministicTutor,
  tutorResponseSchema,
  type TutorContext,
  type TutorResponse,
} from "../lib/tutor";

function baseContext(overrides: Partial<TutorContext> = {}): TutorContext {
  return {
    taskId: "task-normalize",
    taskTitle: "Normalize payments",
    requirements: ["Return a list of normalized payment records."],
    hints: ["Check the envelope key first.", "Strip whitespace from ids.", "Reject negative amounts."],
    hintsUsed: 0,
    code: "def solve(payload):\n    return []",
    execution: null,
    failedTests: [],
    taskUrl: "#task/task-normalize",
    ...overrides,
  };
}

function tutorRequest(body: unknown): Request {
  return new Request("http://localhost/api/tutor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-normalize",
    taskTitle: "Normalize payments",
    requirements: ["Return a list of normalized payment records."],
    hints: ["Check the envelope key first.", "Strip whitespace from ids."],
    hintsUsed: 1,
    code: "def solve(payload):\n    return []",
    execution: null,
    failedTests: [],
    independentMode: false,
    taskUrl: "#task/task-normalize",
    ...overrides,
  };
}

const validTutorJson: TutorResponse = {
  summary: "Provider summary.",
  diagnosis: ["Provider diagnosis."],
  nextSteps: ["Provider next step."],
  hintLevel: 2,
  references: [{ label: "Lesson", url: "#task/task-normalize" }],
};


describe("tutor response schema", () => {
  it("accepts the spec shape", () => {
    expect(tutorResponseSchema.safeParse(validTutorJson).success).toBe(true);
  });
  it("rejects malformed responses", () => {
    expect(tutorResponseSchema.safeParse({ summary: "x" }).success).toBe(false);
    expect(tutorResponseSchema.safeParse({ ...validTutorJson, hintLevel: "two" }).success).toBe(false);
    expect(tutorResponseSchema.safeParse({ ...validTutorJson, references: [{ label: "x" }] }).success).toBe(false);
  });
});

describe("deterministic tutor", () => {
  it("returns a schema-valid response with no network access", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const tutor = deterministicTutor(baseContext());
    expect(tutorResponseSchema.safeParse(tutor).success).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("explains a runtime error with file, line, and mechanism", () => {
    const tutor = deterministicTutor(
      baseContext({
        execution: { status: "error", kind: "NameError", file: "main.py", line: 7, message: "name 'total' is not defined" },
      }),
    );
    expect(tutor.summary).toContain("main.py");
    expect(tutor.summary).toContain("7");
    expect(tutor.diagnosis.join(" ")).toContain("name 'total' is not defined");
    // Mechanism-based, not a keyword bag: NameError gets the defined-before-use explanation.
    expect(tutor.diagnosis.join(" ").toLowerCase()).toContain("before it was defined");
  });

  it("personalizes the next step from the next unrevealed hint rung", () => {
    const tutor = deterministicTutor(baseContext({ hintsUsed: 1 }));
    expect(tutor.hintLevel).toBe(2);
    expect(tutor.nextSteps.join(" ")).toContain("Strip whitespace from ids.");
  });

  it("caps the hint level at the number of authored hints", () => {
    const tutor = deterministicTutor(baseContext({ hintsUsed: 9 }));
    expect(tutor.hintLevel).toBe(3);
  });

  it("names the failed checks in the diagnosis", () => {
    const tutor = deterministicTutor(baseContext({ failedTests: ["sums amounts", "rejects blanks"] }));
    expect(tutor.diagnosis.join(" ")).toContain("sums amounts");
    expect(tutor.diagnosis.join(" ")).toContain("rejects blanks");
  });

  it("offers a review prompt when there is nothing failing yet", () => {
    const tutor = deterministicTutor(baseContext());
    expect(tutor.nextSteps.join(" ").toLowerCase()).toContain("review prompt");
  });

  it("only references the app's own lesson content", () => {
    const tutor = deterministicTutor(baseContext());
    expect(tutor.references.length).toBeGreaterThan(0);
    for (const ref of tutor.references) {
      expect(ref.url.startsWith("#") || ref.url.startsWith("/")).toBe(true);
    }
  });

  it("never mutates the input context", () => {
    const ctx = baseContext();
    const before = JSON.stringify(ctx);
    const frozen = JSON.parse(before) as TutorContext;
    (function deepFreeze(value: unknown): void {
      if (value && typeof value === "object") {
        for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
        Object.freeze(value);
      }
    })(frozen);
    expect(() => deterministicTutor(frozen)).not.toThrow();
    expect(JSON.stringify(ctx)).toBe(before);
  });
});

describe("tutor route", () => {
  it("returns a deterministic answer for a valid request", async () => {
    const res = await POST(tutorRequest(baseBody()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("deterministic");
    expect(tutorResponseSchema.safeParse(data.tutor).success).toBe(true);
  });

  it("rejects independent-mode requests before answering", async () => {
    const res = await POST(tutorRequest(baseBody({ independentMode: true })));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("independent_mode");
  });

  it("rejects invalid JSON and invalid request bodies", async () => {
    const invalidJson = await POST(new Request("http://localhost/api/tutor", { method: "POST", body: "{" }));
    expect(invalidJson.status).toBe(400);
    expect(await POST(tutorRequest({ taskId: "" })).then(res => res.status)).toBe(400);
  });

  it("keeps deterministic tutor references inside the app", () => {
    for (const url of ["https://phishing.example/task", "//evil.example/x", "javascript:alert(1)", "/\n/evil.example"]) {
      const tutor = deterministicTutor(baseContext({ taskUrl: url }));
      expect(tutor.references[0].url).toBe("#");
    }
    expect(deterministicTutor(baseContext({ taskUrl: "#task/x" })).references[0].url).toBe("#task/x");
    expect(deterministicTutor(baseContext({ taskUrl: "/lessons/x" })).references[0].url).toBe("/lessons/x");
  });
});
describe("tutor panel presentation", () => {
  const props = {
    taskId: "task-normalize",
    taskTitle: "Normalize payments",
    requirements: ["Return a list."],
    hints: ["Check the envelope."],
    hintsUsed: 0,
    code: "def solve(x):\n    return []",
    execution: null,
    failedTests: [],
    taskUrl: "#task/task-normalize",
    onTutorUsed: () => undefined,
  };
  it("hides the AI affordance in Learning Mode", () => {
    const markup = renderToStaticMarkup(<TutorPanel {...props} visible={false} />);
    expect(markup).not.toContain("Ask tutor");
  });
  it("shows the ask affordance when Learning Mode is off", () => {
    const markup = renderToStaticMarkup(<TutorPanel {...props} visible={true} />);
    expect(markup).toContain("Ask tutor");
  });
  it("labels AI suggestions visibly", () => {
    const markup = renderToStaticMarkup(<TutorResponseView tutor={validTutorJson} />);
    expect(markup).toContain("AI suggestion");
    expect(markup).toContain("Provider summary.");
  });
});
