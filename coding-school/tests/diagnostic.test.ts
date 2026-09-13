import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { createDefaultState, migrateState, startOrResumeMission } from "../lib/state";
import { selectToday } from "../lib/adaptive";
import { failureResult, aggregateResult } from "../public/grading/protocol.js";
import { getGrader } from "../public/grading/catalog.js";
import type { LearningState } from "../lib/state";

// A missing bank is itself a broken content contract; this also gives a clean RED
// before the diagnostic implementation exists.
async function api() {
  expect(existsSync("curriculum/diagnostic.ts"), "authored diagnostic bank exists").toBe(true);
  return import("../lib/diagnostic");
}
async function unableToAnswer(state:LearningState){
  const d=await api();const s=d.currentDiagnostic(state)!;const item=d.getDiagnosticItem(s.currentItemId!)!;
  if(item.kind==="code"){
    const draft=d.diagnosticDraft(s,item);const request={type:"run" as const,requestId:crypto.randomUUID(),exerciseId:item.id,graderId:item.graderId!,files:draft.sourceFiles};
    state=d.recordDiagnosticAttempt(state,s.id,item.id,request.requestId,draft.sourceFiles,failureResult(request,"The supplied code did not run."));
  }
  return d.submitDiagnostic(state,s.id,item.id,{requestId:crypto.randomUUID(),skip:item.kind==="short"});
}
describe("adaptive placement baseline", () => {
  it("provides validated stable content across every requested topic", async () => {
    const d = await api();
    expect(d.diagnosticItems.length).toBeGreaterThanOrEqual(40);
    expect(new Set(d.diagnosticItems.map(i => i.id)).size).toBe(d.diagnosticItems.length);
    expect(d.diagnosticSkills.map(s => s.id)).toEqual(["variables", "strings", "conditionals", "loops", "functions", "collections", "exceptions", "reasoning", "comprehensions", "modules", "files", "csv-json", "classes", "http", "data"]);
    expect(d.validateDiagnosticContent().success).toBe(true);
  });
  it("probes core breadth first and resumes the exact question and draft", async () => {
    const d = await api(); let state = d.startDiagnostic(createDefaultState());
    const first = d.currentDiagnostic(state)!;
    state = d.saveDiagnosticDraft(state, first.id, first.currentItemId!, { answer: "a draft", sourceFiles: {"main.py": "print('kept')"}, hintsUsed: 1, aiAssisted: true });
    const reloaded = migrateState(JSON.parse(JSON.stringify(state)));
    expect(d.startDiagnostic(reloaded)).toEqual(reloaded);
    expect(d.currentDiagnostic(reloaded)?.drafts[first.currentItemId!]).toMatchObject({ answer: "a draft", hintsUsed: 1, aiAssisted: true });
    const seen = [];
    for (let n = 0; n < 8; n++) {
      const session = d.currentDiagnostic(state)!; const item = d.getDiagnosticItem(session.currentItemId!)!;
      seen.push(item.skillId); state = await unableToAnswer(state);
    }
    expect(new Set(seen).size).toBe(8);
  });
  it("normalizes precise answers, accepts semantic equivalents, and rejects keyword soup", async () => {
    const d = await api();
    expect(d.gradeShortAnswer(d.getDiagnosticItem("variables-read")!, "  23, STR  ").passed).toBe(true);
    expect(d.gradeShortAnswer(d.getDiagnosticItem("variables-read")!, "5 int").passed).toBe(false);
    expect(d.gradeShortAnswer(d.getDiagnosticItem("exceptions-easy")!, "Catch ValueError around int conversion; skip that row and keep processing the others.").passed).toBe(true);
    expect(d.gradeShortAnswer(d.getDiagnosticItem("exceptions-easy")!, "ValueError int skip conversion").passed).toBe(false);
    expect(d.gradeShortAnswer(d.getDiagnosticItem("exceptions-easy")!, "Do not catch ValueError; stop processing all rows.").passed).toBe(false);
  });
  it("finishes only after breadth, 12 minimum questions and five executable submissions; caps uncertainty at 25", async () => {
    const d = await api(); let state = d.startDiagnostic(createDefaultState());
    for (let n = 0; n < 25; n++) {
      const s = d.currentDiagnostic(state)!;
      expect(s.status).toBe("active");
      state = await unableToAnswer(state);
      if (n < 11) expect(d.currentDiagnostic(state)?.status).toBe("active");
    }
    const s = d.currentDiagnostic(state)!;
    expect(s.status).toBe("completed");
    expect(s.responses).toHaveLength(25);
    expect(s.responses.filter(r => d.getDiagnosticItem(r.itemId)?.kind === "code").length).toBeGreaterThanOrEqual(5);
    expect(d.selectDiagnosticItem(s)).toBeUndefined();
    expect(s.profile.some(p => p.band === "Untested")).toBe(true);
    expect(s.profile.every(p => p.band !== "Strong evidence")).toBe(true);
  });
  it("rejects stale item/results, keeps submission retries idempotent, and preserves assistance", async () => {
    const d = await api(); let state = d.startDiagnostic(createDefaultState()); const s = d.currentDiagnostic(state)!;
    const item = d.getDiagnosticItem(s.currentItemId!)!;
    state = d.saveDiagnosticDraft(state, s.id, item.id, { answer: "23 str", sourceFiles: {}, hintsUsed: 1, aiAssisted: true });
    const request = { requestId: crypto.randomUUID() };
    state = d.submitDiagnostic(state, s.id, item.id, request);
    expect(d.submitDiagnostic(state, s.id, item.id, request)).toEqual(state);
    expect(() => d.submitDiagnostic(state, s.id, item.id, { requestId: crypto.randomUUID() })).toThrow(/current|stale/i);
    expect(d.currentDiagnostic(state)?.responses[0]).toMatchObject({ hintsUsed: 1, aiAssisted: true });
    expect(state.mastery).toEqual({}); expect(state.missionRuns).toEqual([]); expect(state.attempts).toEqual([]);
  });
  it("uses placement evidence in Today while always resuming a mission first", async () => {
    const d = await api(); let state = d.startDiagnostic(createDefaultState());
    while(d.currentDiagnostic(state)?.status === "active") state=await unableToAnswer(state);
    const selection = selectToday(state, new Date());
    expect(selection.reason).toMatch(/placement|baseline/i);
    expect(selection.evidenceIds?.length).toBeGreaterThan(0);
    state = startOrResumeMission(state);
    expect(selectToday(state, new Date()).kind).toBe("resume");
    expect(state.missionRuns[0].status).toBe("active");
    expect(Object.keys(state.mastery)).toHaveLength(0);
  });
  it("requires a coding attempt even when the learner cannot solve the item",async()=>{
    const d=await api();let state=d.startDiagnostic(createDefaultState());state=await unableToAnswer(state);
    const s=d.currentDiagnostic(state)!;
    expect(()=>d.submitDiagnostic(state,s.id,s.currentItemId!,{requestId:crypto.randomUUID(),skip:true})).toThrow(/run checks/i);
  });
  it("selects harder confirmations, easier repair and stops a varied confident skill",async()=>{
    const d=await api();const state=d.startDiagnostic(createDefaultState());const session=d.currentDiagnostic(state)!;
    session.responses=["variables-read","strings-code","conditionals-code","loops-code","functions-code","collections-code","exceptions-read","reasoning-read"].map((itemId,n)=>({id:`r${n}`,itemId,answer:"",outcome:"passed" as const,feedback:"",attemptId:itemId.endsWith("code")?`a${n}`:null,hintsUsed:0,aiAssisted:false,completedAt:new Date().toISOString()}));
    expect(d.selectDiagnosticItem(session)?.id).toBe("variables-code");
    session.responses[0].outcome="needs-practice";
    expect(d.selectDiagnosticItem(session)?.id).toBe("variables-easy");
    session.responses[0].outcome="passed";
    session.responses.push({...session.responses[0],id:"r-confirm",itemId:"variables-code",attemptId:"a-confirm"});
    expect(d.deriveDiagnosticProfile(session)[0]).toMatchObject({band:"Strong evidence",confidence:"Varied",responseIds:["r0","r-confirm"]});
    expect(d.selectDiagnosticItem(session)?.skillId).not.toBe("variables");
    session.responses.at(-1)!.hintsUsed=1;
    expect(d.deriveDiagnosticProfile(session)[0].band).toBe("Working evidence");
  });
  it("rejects a worker result after code edits and refuses forged saved practical claims",async()=>{
    const d=await api();let state=d.startDiagnostic(createDefaultState());state=await unableToAnswer(state);
    const session=d.currentDiagnostic(state)!;const item=d.getDiagnosticItem(session.currentItemId!)!;const draft=d.diagnosticDraft(session,item);
    const request={type:"run" as const,requestId:crypto.randomUUID(),exerciseId:item.id,graderId:item.graderId!,files:draft.sourceFiles};
    const grader=getGrader(item.id,item.graderId!)!;
    const result=aggregateResult(request,{executionOk:true,tests:grader.requiredTests.map((id:string)=>({id,name:id,passed:true,required:true,detail:""}))});
    state=d.saveDiagnosticDraft(state,session.id,item.id,{...draft,sourceFiles:{"main.py":"# changed"}});
    expect(()=>d.recordDiagnosticAttempt(state,session.id,item.id,request.requestId,draft.sourceFiles,result)).toThrow(/stale/i);
    const forged=JSON.parse(JSON.stringify(state));forged.diagnostic.sessions[0].responses[0].outcome="passed";
    expect(()=>migrateState(forged)).toThrow(/conceptual evidence/i);
  });
  it("keeps failed coding trials visible when a later revision passes",async()=>{
    const d=await api();const session=d.currentDiagnostic(d.startDiagnostic(createDefaultState()))!;
    const time=new Date().toISOString();
    session.responses=[{id:"answer",itemId:"strings-code",answer:"",outcome:"passed",feedback:"",attemptId:"passed-trial",hintsUsed:0,aiAssisted:false,completedAt:time}];
    session.attempts=[{id:"failed-trial",itemId:"strings-code",sourceFiles:{"main.py":"return ''"},graderId:"diag-strings-v1",graderVersion:"1.0.0",passed:false,executionOk:true,checks:[],hintsUsed:0,aiAssisted:false,completedAt:time},{id:"passed-trial",itemId:"strings-code",sourceFiles:{"main.py":"return value.strip()"},graderId:"diag-strings-v1",graderVersion:"1.0.0",passed:true,executionOk:true,checks:[],hintsUsed:0,aiAssisted:false,completedAt:time}];
    expect(d.deriveDiagnosticProfile(session).find(p=>p.skillId==="strings")).toMatchObject({confidence:"Conflicting",attemptIds:["failed-trial","passed-trial"]});
  });
});
