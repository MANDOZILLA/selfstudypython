import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/tutor/route";
import { TutorPanel, TutorResponseView } from "../app/studio/tutor-panel";
import {
  deterministicTutor,
  tutorResponseSchema,
  type TutorContext,
  type TutorResponse,
} from "../lib/tutor";

const ROOT = resolve(__dirname, "..");

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

function providerResponse(content: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }], usage: {} }),
    { status, headers: { "content-type": "application/json", ...headers } },
  );
}

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
  const savedEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.TUTOR_MODEL;
    delete process.env.TUTOR_TIMEOUT_MS;
    delete process.env.TUTOR_MAX_RESPONSE_BYTES;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    vi.unstubAllGlobals();
  });

  it("answers deterministically with no key and makes zero provider calls", async () => {
    const res = await POST(tutorRequest(baseBody()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("deterministic");
    expect(tutorResponseSchema.safeParse(data.tutor).success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects independent-mode requests server-side without calling the provider", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-testkey";
    const res = await POST(tutorRequest(baseBody({ independentMode: true })));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("independent_mode");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid request bodies", async () => {
    const res = await POST(tutorRequest({ taskId: "" }));
    expect(res.status).toBe(400);
  });

  it("accepts a valid provider response and authenticates correctly", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-testkey";
    process.env.TUTOR_MODEL = "openai/gpt-4o-mini";
    fetchMock.mockResolvedValue(providerResponse(JSON.stringify(validTutorJson)));
    const res = await POST(tutorRequest(baseBody()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("openrouter");
    expect(data.tutor).toEqual(validTutorJson);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk-or-v1-testkey");
    expect(JSON.parse(init.body as string).model).toBe("openai/gpt-4o-mini");
  });

  it("falls back when the provider returns malformed JSON", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-testkey";
    fetchMock.mockResolvedValue(providerResponse("this is not json"));
    const res = await POST(tutorRequest(baseBody()));
    const data = await res.json();
    expect(data.source).toBe("deterministic");
    expect(tutorResponseSchema.safeParse(data.tutor).success).toBe(true);
    expect(typeof data.fallbackReason).toBe("string");
  });

  it("falls back when the provider JSON fails schema validation", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-testkey";
    fetchMock.mockResolvedValue(providerResponse(JSON.stringify({ summary: "incomplete" })));
    const data = await (await POST(tutorRequest(baseBody()))).json();
    expect(data.source).toBe("deterministic");
  });

  it("falls back on provider timeout", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-testkey";
    process.env.TUTOR_TIMEOUT_MS = "60";
    // A hanging fetch that rejects with AbortError on abort, like real fetch.
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const started = Date.now();
    const data = await (await POST(tutorRequest(baseBody()))).json();
    expect(Date.now() - started).toBeLessThan(5000);
    expect(data.source).toBe("deterministic");
    expect(data.fallbackReason).toBe("timeout");
  });

  it("falls back on 429 and 401", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-testkey";
    for (const [status, reason] of [[429, "rate_limited"], [401, "unauthorized"]] as const) {
      fetchMock.mockResolvedValue(new Response("nope", { status }));
      const data = await (await POST(tutorRequest(baseBody()))).json();
      expect(data.source).toBe("deterministic");
      expect(data.fallbackReason).toBe(reason);
    }
  });

  it("falls back on oversized provider responses", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-testkey";
    process.env.TUTOR_MAX_RESPONSE_BYTES = "100";
    fetchMock.mockResolvedValue(providerResponse(JSON.stringify(validTutorJson).padEnd(10000, "x")));
    const data = await (await POST(tutorRequest(baseBody()))).json();
    expect(data.source).toBe("deterministic");
    expect(data.fallbackReason).toBe("oversized");
  });

  it("never leaks the API key in responses or error paths", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-SECRETXYZ";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "bad key sk-or-v1-SECRETXYZ" }), { status: 401 }),
    );
    const res = await POST(tutorRequest(baseBody()));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("SECRETXYZ");
    // The invalid-body path also stays clean.
    const bad = await POST(tutorRequest({ nope: true }));
    expect(JSON.stringify(await bad.json())).not.toContain("SECRETXYZ");
  });
});

describe("client bundle hygiene", () => {
  it("no client module references the server-side API key", () => {
    for (const file of ["app/studio/tutor-panel.tsx", "app/studio/workbench.tsx", "lib/tutor.ts"]) {
      const source = readFileSync(resolve(ROOT, file), "utf8");
      expect(source).not.toContain("OPENROUTER_API_KEY");
    }
  });
  it("the client tutor panel never imports the server-only provider module", () => {
    const source = readFileSync(resolve(ROOT, "app/studio/tutor-panel.tsx"), "utf8");
    expect(source).not.toContain("tutor-provider");
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
