import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssessmentWorkbench } from "../app/studio/assessment-workbench";
import { createDefaultState } from "../lib/state";

/**
 * Regression test: the assessment workbench is always rendered inside the
 * dashboard's <main id="main-content">. Rendering its own <main id> nests
 * <main> landmarks and duplicates the id, which breaks strict-mode selectors
 * and assistive technology. It must not emit its own main landmark or the
 * shared id.
 */
function renderNested(): string {
  const studio = { state: createDefaultState() } as never;
  return renderToStaticMarkup(
    <main id="main-content" className="dashboard">
      <AssessmentWorkbench studio={studio} />
    </main>,
  );
}

describe("assessment workbench landmarks", () => {
  it("does not duplicate the main-content id when nested in the dashboard", () => {
    const html = renderNested();
    const occurrences = html.match(/id="main-content"/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("does not nest a main landmark inside the dashboard main", () => {
    const html = renderNested();
    const mains = html.match(/<main[\s>]/g) ?? [];
    expect(mains).toHaveLength(1);
  });
});
