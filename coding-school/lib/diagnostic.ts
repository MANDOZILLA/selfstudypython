import { z } from "zod";
import { diagnosticItems, diagnosticSkills } from "../curriculum/diagnostic";
import { diagnosticItemSchema, diagnosticStateSchema, type DiagnosticDraft, type DiagnosticItem, type DiagnosticProfile, type DiagnosticSession } from "./diagnostic-types";
import type { LearningState } from "./state";
import type { GradeResult } from "./runner";
import { getGrader } from "../public/grading/catalog.js";
import { verifyWorkerResult } from "../public/grading/protocol.js";
export { diagnosticItems, diagnosticSkills };
export const getDiagnosticItem = (id: string) => diagnosticItems.find(i => i.id === id);
export const currentDiagnostic = (state: LearningState) => state.diagnostic.sessions?.at(-1);
export const diagnosticDraft = (session: DiagnosticSession, item: DiagnosticItem): DiagnosticDraft => session.drafts[item.id] ?? { answer: "", sourceFiles: item.kind === "code" ? {"main.py": item.starter!} : {}, hintsUsed: 0, aiAssisted: false };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const filesEqual = (a: Record<string,string>, b: Record<string,string>) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k,v]) => b[k] === v);
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[`'"\[\],]/g, " ").replace(/\s+/g, " ").trim();
export function gradeShortAnswer(item: DiagnosticItem, answer: string) {
  const text = normalize(answer); const rubric = item.rubric;
  const passed = item.kind === "short" && !!rubric && !(rubric.reject ?? []).some(r => new RegExp(r,"i").test(text)) &&
    ((rubric.accepted ?? []).some(a => normalize(a) === text) || Boolean(rubric.elements?.length && text.split(" ").length >= 8 && rubric.elements.every(r => new RegExp(r,"i").test(text))));
  return { passed, feedback: passed ? "This response matches the authored rubric. It is conceptual evidence only." : "This response did not establish the requested behavior. The placement will treat it as an area to revisit; no solution is revealed." };
}
export function deriveDiagnosticProfile(session: DiagnosticSession): DiagnosticProfile[] {
  return diagnosticSkills.map(skill => {
    const responses = session.responses.filter(r => getDiagnosticItem(r.itemId)?.skillId === skill.id);
    const observed = responses.filter(r => r.outcome !== "skipped");
    const conceptual = observed.filter(r => getDiagnosticItem(r.itemId)?.kind === "short");
    const coding = observed.filter(r => r.attemptId !== null);
    const trials = session.attempts.filter(a=>responses.some(r=>r.itemId===a.itemId));
    const independent = observed.filter(r => r.outcome === "passed" && !r.hintsUsed && !r.aiAssisted);
    const failures = observed.some(r => r.outcome === "needs-practice") || trials.some(a=>!a.passed);
    const conflict = failures && observed.some(r => r.outcome === "passed");
    const varied = independent.some(r => getDiagnosticItem(r.itemId)?.kind === "short") && independent.some(r => getDiagnosticItem(r.itemId)?.kind === "code") && !failures;
    const band = !observed.length ? "Untested" : varied ? "Strong evidence" : failures ? "Needs practice" : "Working evidence";
    return { skillId: skill.id, band, confidence: !observed.length ? "None" : conflict ? "Conflicting" : varied ? "Varied" : "Limited", evidenceCount: observed.length, conceptualCount: conceptual.length, codingCount: coding.length, latestResult: responses.at(-1)?.outcome ?? null,
      responseIds: responses.map(r => r.id), attemptIds: trials.map(a=>a.id),
      notes: !observed.length ? responses.length ? "Presented but not attempted; ability remains untested." : "No question sampled this skill." : `${conceptual.length} conceptual response(s), ${coding.length} coding response(s). ${varied ? "Independent success in both forms; placement evidence only, not mastery." : conflict ? "The responses disagree; additional practical work is needed." : coding.length ? "Limited practical evidence; varied independent work is still needed." : "No executable evidence yet; conceptual answers do not establish practical strength."}${observed.some(r=>r.hintsUsed||r.aiAssisted) ? " Assistance was used and limits independent claims." : ""}` };
  });
}
/** Stable authored ordering breaks ties. First probe all eight foundations, then
 * use harder/mixed-format confirmations or easier repairs, capped at 25 items. */
export function selectDiagnosticItem(session: DiagnosticSession): DiagnosticItem | undefined {
  const answered = new Set(session.responses.map(r => r.itemId));
  if (answered.size >= 25) return undefined;
  const profile = deriveDiagnosticProfile(session);
  const core = diagnosticSkills.filter(s => s.core);
  for (const skill of core) if (!session.responses.some(r=>getDiagnosticItem(r.itemId)?.skillId===skill.id)) return diagnosticItems.find(i=>i.skillId===skill.id && i.difficulty===2);
  const codingCount = session.responses.filter(r=>r.attemptId!==null).length;
  const coreProfile=profile.filter(p=>core.some(s=>s.id===p.skillId));
  if (answered.size>=12 && codingCount>=5 && coreProfile.filter(p=>p.band==="Strong evidence").length>=4 && coreProfile.every(p=>p.latestResult==="passed" && p.confidence!=="Conflicting")) return undefined;
  let candidates=diagnosticItems.filter(i=>!answered.has(i.id) && profile.find(p=>p.skillId===i.skillId)?.band!=="Strong evidence");
  if (25-answered.size <= 5-codingCount) candidates=candidates.filter(i=>i.kind==="code");
  const weight=(item: DiagnosticItem) => {
    const p=profile.find(p=>p.skillId===item.skillId)!;
    const last=session.responses.filter(r=>getDiagnosticItem(r.itemId)?.skillId===item.skillId).at(-1);
    const target=last?.outcome==="passed" && !last.hintsUsed && !last.aiAssisted ? 3 : last ? 1 : 2;
    const mixed=last && getDiagnosticItem(last.itemId)?.kind!==item.kind;
    return (p.confidence==="Conflicting"?100:0)+(p.band==="Needs practice"?30:0)+(last?40:0)+(diagnosticSkills.find(s=>s.id===item.skillId)?.core?20:0)-Math.abs(target-item.difficulty)*8+(mixed && last?.outcome==="passed"?10:0);
  };
  return candidates.sort((a,b)=>weight(b)-weight(a))[0];
}
export function startDiagnostic(state: LearningState, now=new Date(), retake=false): LearningState {
  const current=currentDiagnostic(state);
  if (current?.status==="active" || (current && !retake)) return state;
  const next=copy(state); const session: DiagnosticSession={ id:crypto.randomUUID(), version:"1.0.0", status:"active", currentItemId:null, drafts:{}, attempts:[], responses:[], profile:[], startedAt:now.toISOString(), completedAt:null };
  session.currentItemId=selectDiagnosticItem(session)!.id; session.profile=deriveDiagnosticProfile(session);
  next.diagnostic={...next.diagnostic,sessions:[...(next.diagnostic.sessions??[]),session]}; return next;
}
function active(state:LearningState, sessionId:string,itemId:string) {
  const session=currentDiagnostic(state);
  if (!session || session.id!==sessionId || session.status!=="active" || session.currentItemId!==itemId) throw new Error("This result is stale; resume the current diagnostic question.");
  const item=getDiagnosticItem(itemId); if(!item) throw new Error("This diagnostic item is unavailable.");
  return {session,item};
}
export function saveDiagnosticDraft(state:LearningState,sessionId:string,itemId:string,draft:DiagnosticDraft):LearningState {
  const next=copy(state); const {session,item}=active(next,sessionId,itemId); const prior=diagnosticDraft(session,item);
  session.drafts[itemId]={...copy(draft),hintsUsed:Math.max(prior.hintsUsed,draft.hintsUsed),aiAssisted:prior.aiAssisted||draft.aiAssisted}; return next;
}
export function recordDiagnosticAttempt(state:LearningState,sessionId:string,itemId:string,requestId:string,sourceFiles:Record<string,string>,result:GradeResult,now=new Date()):LearningState {
  const next=copy(state); const {session,item}=active(next,sessionId,itemId); const draft=diagnosticDraft(session,item);
  if(session.attempts.some(a=>a.id===requestId)) return state;
  if(item.kind!=="code" || !filesEqual(draft.sourceFiles,sourceFiles)) throw new Error("This result is stale; run the current code again.");
  const verified=verifyWorkerResult({type:"run",requestId,exerciseId:item.id,graderId:item.graderId!,files:sourceFiles},result);
  if(!verified || verified.graderVersion!==getGrader(item.id,item.graderId!)?.version) throw new Error("The diagnostic grader result could not be verified.");
  session.attempts.push({id:requestId,itemId,sourceFiles:copy(sourceFiles),graderId:item.graderId!,graderVersion:verified.graderVersion,passed:verified.passed,executionOk:verified.executionOk,checks:verified.tests,hintsUsed:draft.hintsUsed,aiAssisted:draft.aiAssisted,completedAt:now.toISOString()}); return next;
}
export function submitDiagnostic(state:LearningState,sessionId:string,itemId:string,input:{requestId:string;skip?:boolean},now=new Date()):LearningState {
  const prior=currentDiagnostic(state);
  if(prior?.id===sessionId && prior.responses.some(r=>r.id===input.requestId && r.itemId===itemId)) return state;
  const next=copy(state); const {session,item}=active(next,sessionId,itemId); const draft=diagnosticDraft(session,item);
  const attempt=session.attempts.filter(a=>a.itemId===itemId && filesEqual(a.sourceFiles,draft.sourceFiles)).at(-1);
  if(item.kind==="code" && (input.skip || !attempt)) throw new Error("Run checks on the current code and record that attempt before continuing.");
  const short=gradeShortAnswer(item,draft.answer);
  const outcome=input.skip ? "skipped" : (item.kind==="code"?attempt!.passed:short.passed)?"passed":"needs-practice";
  session.responses.push({id:input.requestId,itemId,answer:draft.answer,outcome,feedback:input.skip?"Not attempted; this skill remains uncertain.":item.kind==="short"?short.feedback:attempt!.passed?"The executable contract passed for this code.":"This code did not meet the executable contract. Use this as a repair recommendation.",attemptId:item.kind==="code" && !input.skip?attempt!.id:null,hintsUsed:draft.hintsUsed,aiAssisted:draft.aiAssisted,completedAt:now.toISOString()});
  session.profile=deriveDiagnosticProfile(session); session.currentItemId=selectDiagnosticItem(session)?.id??null;
  if(!session.currentItemId){session.status="completed";session.completedAt=now.toISOString();next.diagnostic.completed=true;next.diagnostic.completedAt=session.completedAt;}
  return next;
}
export function placementRecommendation(state:LearningState,missionId:string) {
  const session=[...(state.diagnostic.sessions??[])].reverse().find(s=>s.status==="completed");
  if(!session) return {missionId,reason:"Begin with the mission overview and build independent project evidence.",evidenceIds:[] as string[]};
  const profile=deriveDiagnosticProfile(session);
  const uncertain=profile.filter(p=>p.band!=="Strong evidence");
  const relevant=uncertain.filter(p=>diagnosticSkills.find(s=>s.id===p.skillId)?.core);
  const priority=(p:DiagnosticProfile)=>p.band==="Needs practice"?0:p.band==="Working evidence"?1:2;
  const focus=(relevant.length?relevant:uncertain).sort((a,b)=>priority(a)-priority(b)).slice(0,3);
  return {missionId,reason:`Placement baseline: ${focus.length?`revisit ${focus.map(p=>diagnosticSkills.find(s=>s.id===p.skillId)!.title.toLowerCase()).join(", ")} during the mission's worked examples and practice.`:"the sampled foundations support starting this project's guided work."} Mission prerequisites still require completed projects.`,evidenceIds:(focus.length?focus:profile).flatMap(p=>p.responseIds),profile};
}
export function validateDiagnosticContent() {
  return z.array(diagnosticItemSchema).superRefine((items,ctx)=>{
    if(new Set(items.map(i=>i.id)).size!==items.length) ctx.addIssue({code:"custom",message:"Duplicate diagnostic IDs"});
    for(const i of items) if(!diagnosticSkills.some(s=>s.id===i.skillId)|| (i.kind==="code"?!i.starter||!getGrader(i.id,i.graderId!):!i.rubric)) ctx.addIssue({code:"custom",message:`Invalid diagnostic contract: ${i.id}`});
  }).safeParse(diagnosticItems);
}
/** Saved profiles are caches. Recompute from canonical responses and verified checks. */
export function normalizeDiagnostic(value:unknown) {
  const parsed=diagnosticStateSchema.safeParse(value); if(!parsed.success) throw new Error("Invalid diagnostic data.");
  for(const session of parsed.data.sessions??[]){
    if(new Set(session.responses.map(r=>r.id)).size!==session.responses.length || new Set(session.responses.map(r=>r.itemId)).size!==session.responses.length || session.responses.length>25) throw new Error("Duplicate diagnostic responses.");
    for(const r of session.responses){
      const item=getDiagnosticItem(r.itemId); if(!item) throw new Error("Unavailable diagnostic response.");
      if(r.outcome==="skipped") continue;
      if(item.kind==="short") {if((r.outcome==="passed")!==gradeShortAnswer(item,r.answer).passed || r.attemptId!==null) throw new Error("Invalid conceptual evidence.");}
      else {const a=session.attempts.find(a=>a.id===r.attemptId && a.itemId===item.id);if(!a || (r.outcome==="passed")!==a.passed || r.hintsUsed<a.hintsUsed || (!r.aiAssisted && a.aiAssisted)) throw new Error("Invalid coding evidence.");}
    }
    for(const a of session.attempts){
      const item=getDiagnosticItem(a.itemId);const grader=item&&getGrader(item.id,item.graderId!);
      if(!grader || a.graderVersion!==grader.version || a.graderId!==item!.graderId) throw new Error("Unavailable diagnostic grader version.");
      if(a.passed!==Boolean(a.executionOk && grader.requiredTests.every((id:string)=>a.checks.some(c=>c.id===id && c.passed && c.required)))) throw new Error("Invalid diagnostic checks.");
    }
    session.profile=deriveDiagnosticProfile(session);
    const selected=selectDiagnosticItem(session)?.id??null;
    if(session.currentItemId!==selected || (session.status==="completed")!==(selected===null)) throw new Error("Invalid diagnostic position.");
  }
  return parsed.data;
}
