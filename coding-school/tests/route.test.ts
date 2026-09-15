import { describe, expect, it } from "vitest";
import { readRoute, routeHash } from "../lib/route";

describe("diagnostic hash routing", () => {
  it("parses a diagnostic session hash", () => {
    expect(readRoute("#diagnostic?session=abc-123")).toEqual({ destination: "today", diagnosticSessionId: "abc-123" });
  });
  it("round-trips diagnostic routes through the hash", () => {
    const route = { destination: "today" as const, diagnosticSessionId: "session-1" };
    expect(readRoute(routeHash(route))).toEqual(route);
  });
  it("keeps existing routes working", () => {
    expect(readRoute("#today")).toEqual({ destination: "today" });
    expect(readRoute("#workbench?run=r1&task=t1")).toEqual({ destination: "today", runId: "r1", taskId: "t1" });
    expect(readRoute("#summary?run=r1")).toEqual({ destination: "today", completedRunId: "r1" });
    expect(readRoute("#diagnostic")).toEqual({ destination: "today" });
    expect(readRoute("#nope")).toEqual({ destination: "today" });
    expect(routeHash({ destination: "learned" })).toBe("#learned");
  });
});
