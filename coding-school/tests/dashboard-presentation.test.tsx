import { renderToStaticMarkup } from "react-dom/server";
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
    expect(markup).toContain("code-reading");
    expect(markup).toContain("debugging");
    // The hub states the no-solutions policy explicitly.
    expect(markup).toContain("No solutions are shown");
  });

  it("explains the completion/mastery separation", () => {
    const markup = assessmentMarkup();
    expect(markup).toContain("completed");
    expect(markup).toContain("mastered");
    expect(markup).toContain("Assisted success is practice");
  });
});
