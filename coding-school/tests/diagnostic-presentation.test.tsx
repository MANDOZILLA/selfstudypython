import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard } from "../app/studio/dashboard";
import type { Studio } from "../app/studio/use-studio";
import { createDefaultState, startOrResumeMission } from "../lib/state";
it("keeps fresh learners on Today with a dominant placement mission",()=>{
  const markup=renderToStaticMarkup(<Dashboard studio={{state:createDefaultState(),route:{destination:"today"}} as Studio}/>);
  expect(markup).toContain("Establish your placement baseline");
  expect(markup).toContain("Start placement baseline");
  expect(markup).not.toContain('type="radio"');
  expect(markup.indexOf("Establish your placement baseline")).toBeLessThan(markup.indexOf("Your learning record"));
});
it("keeps an active mission as the primary action",()=>{
  const markup=renderToStaticMarkup(<Dashboard studio={{state:startOrResumeMission(createDefaultState()),route:{destination:"today"}} as Studio}/>);
  expect(markup).toContain("Resume mission");
  expect(markup).not.toContain("Establish your placement baseline");
});
