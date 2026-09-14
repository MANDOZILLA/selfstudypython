import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard } from "../app/studio/dashboard";
import type { Studio } from "../app/studio/use-studio";
import { createDefaultState, startOrResumeMission } from "../lib/state";
import { BaselineProfile, DiagnosticWorkbench } from "../app/studio/diagnostic";
import { currentDiagnostic, diagnosticDraft, getDiagnosticItem, startDiagnostic, submitDiagnostic } from "../lib/diagnostic";
import { failureResult } from "../public/grading/protocol.js";
it("keeps fresh learners on Today with a dominant placement mission",()=>{
  const markup=renderToStaticMarkup(<Dashboard studio={{state:createDefaultState(),route:{destination:"today"}} as Studio}/>);
  expect(markup).toContain("Establish your placement baseline");
  expect(markup).toContain("Start placement baseline");
  expect(markup).not.toContain('type="radio"');
  expect(markup.indexOf("Establish your placement baseline")).toBeLessThan(markup.indexOf("Your learning record"));
});
it("offers accessible prior profiles while a retake is current",()=>{
  let state=startDiagnostic(createDefaultState());const prior=currentDiagnostic(state)!;
  prior.status="completed";prior.completedAt=new Date().toISOString();
  state=startDiagnostic(state,new Date(),true);const baseline=currentDiagnostic(state)!;
  const baselineItem=getDiagnosticItem(baseline.currentItemId!)!;
  const markup=renderToStaticMarkup(<DiagnosticWorkbench studio={{state,baseline,baselineItem,baselineDraft:diagnosticDraft(baseline,baselineItem)} as Studio}/>);
  expect(markup).toContain('aria-label="Placement session"');
  expect(markup).toContain(`value="${prior.id}"`);
  expect(markup).toContain("Current session");
  const historical=renderToStaticMarkup(<BaselineProfile studio={{state} as Studio} sessionId={prior.id}/>);
  expect(historical).toContain("Historical session");
  expect(historical).toContain(prior.id);
  expect(historical).not.toContain("Start a new placement baseline");
});
it("shows unavailable execution as not assessed with a retry and no saving claim",()=>{
  let state=startDiagnostic(createDefaultState());const first=currentDiagnostic(state)!;
  state=submitDiagnostic(state,first.id,first.currentItemId!,{requestId:"skip",skip:true});
  const baseline=currentDiagnostic(state)!;const baselineItem=getDiagnosticItem(baseline.currentItemId!)!;const baselineDraft=diagnosticDraft(baseline,baselineItem);
  const result=failureResult({requestId:"infra",exerciseId:baselineItem.id,graderId:baselineItem.graderId},"Pyodide failed to load");
  const markup=renderToStaticMarkup(<DiagnosticWorkbench studio={{state,baseline,baselineItem,baselineDraft,result,status:"Couldn't run"} as Studio}/>);
  expect(markup).toContain("Not assessed");
  expect(markup).toContain("Retry Run checks");
  expect(markup).not.toContain("Saving the check result");
  expect(markup).not.toContain("Needs changes: Execution");
});
it("keeps an active mission as the primary action",()=>{
  const markup=renderToStaticMarkup(<Dashboard studio={{state:startOrResumeMission(createDefaultState()),route:{destination:"today"}} as Studio}/>);
  expect(markup).toContain("Resume mission");
  expect(markup).not.toContain("Establish your placement baseline");
});
