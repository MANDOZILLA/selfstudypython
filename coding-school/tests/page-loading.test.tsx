import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/studio/use-studio", () => ({
  useStudio: () => ({
    ready: false,
    workbench: null,
    storageError: null,
    recoveryRaw: null,
    syncStatus: "booting",
  }),
}));
vi.mock("../app/studio/navigation", () => ({ Navigation: () => <nav /> }));
vi.mock("../app/studio/dashboard", () => ({ Dashboard: () => null }));
vi.mock("../app/studio/diagnostic", () => ({ DiagnosticStudio: () => null }));
vi.mock("../app/studio/workbench", () => ({ Workbench: () => null }));

import Home from "../app/page";

describe("studio loading page", () => {
  it("keeps the skip-link target available while the studio opens", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain('href="#main-content"');
    expect(markup).toContain('<main id="main-content"');
  });
});
