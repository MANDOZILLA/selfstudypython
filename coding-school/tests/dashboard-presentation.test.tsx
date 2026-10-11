import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Dashboard } from "../app/studio/dashboard";
import type { Studio } from "../app/studio/use-studio";
import { createDefaultState } from "../lib/state";

function assessmentMarkup() {
  const studio = {
    state: createDefaultState(),
    route: { destination: "assessment" },
    navigate: () => undefined,
    start: () => undefined,
    applyState: () => undefined,
  } as unknown as Studio;
  return renderToStaticMarkup(<Dashboard studio={studio} />);
}

describe("checkpoint assessment presentation", () => {
  it("lists the three checkpoints with their five components and no solutions", () => {
    const markup = assessmentMarkup();
    expect(markup).toContain("Foundations checkpoint");
    expect(markup).toContain("Data checkpoint");
    expect(markup).toContain("Applied checkpoint");
    expect(markup).toContain("Prove it in a new context.");
    // Skill chips render for the cross-cutting skills.
    expect(markup).toContain("Code reading");
    expect(markup).toContain("Debugging");
    // The hub states the no-solutions policy explicitly.
    expect(markup).toContain("No solutions are shown");
  });

  it("explains the completion/mastery separation", () => {
    const markup = assessmentMarkup();
    expect(markup).toContain("Complete a mission");
    expect(markup).toContain("not a new assessment and not a mastery claim");
    const source = readFileSync(join(process.cwd(), "app/studio/assessment-workbench.tsx"), "utf8");
    expect(source).toContain("assisted success is practice, not mastery");
  });
});
