import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createClient } from "@libsql/client";
import { openRepository } from "../db/repository";
import { createDefaultState } from "../lib/state";
import { currentDiagnostic, diagnosticDraft, getDiagnosticItem, recordDiagnosticAttempt, saveDiagnosticDraft, startDiagnostic, submitDiagnostic } from "../lib/diagnostic";
import { aggregateResult } from "../public/grading/protocol.js";
import { getGrader } from "../public/grading/catalog.js";
it("upgrades a version-one database additively and roundtrips diagnostic response, profile and draft", async()=>{
  const dir=await mkdtemp(join(tmpdir(),"placement-migration-")); const path=join(dir,"test.db");
  const client=createClient({url:`file:${path.replaceAll("\\","/")}`});
  const sql=await readFile("db/migrations/0001_learner.sql","utf8");
  await client.execute("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  for(const statement of sql.split(";").map(s=>s.trim()).filter(Boolean)) await client.execute(statement);
  await client.execute({sql:"INSERT INTO schema_migrations(version,name,checksum) VALUES(1,'0001_learner',?)",args:[createHash("sha256").update(sql.replaceAll("\r\n","\n")).digest("hex")]});
  await client.execute("CREATE TABLE preservation_witness (text TEXT)"); await client.execute("INSERT INTO preservation_witness VALUES ('keep learner data')"); client.close();
  const repo=await openRepository(path);
  try{
    expect((await repo.health()).schemaVersion).toBe(2);
    let state=startDiagnostic(createDefaultState()); const s=currentDiagnostic(state)!;
    state=saveDiagnosticDraft(state,s.id,s.currentItemId!,{answer:"23 str",sourceFiles:{},hintsUsed:0,aiAssisted:false});
    state=submitDiagnostic(state,s.id,s.currentItemId!,{requestId:crypto.randomUUID()});
    const current=currentDiagnostic(state)!;
    state=saveDiagnosticDraft(state,current.id,current.currentItemId!,{answer:"",sourceFiles:{"main.py":"def solve(value):\n    return value.strip()"},hintsUsed:1,aiAssisted:false});
    await repo.save({state,requestId:crypto.randomUUID(),revision:0,learningMode:true,operation:"save"});
    expect((await repo.load()).state).toEqual(state);
    expect(await repo.health()).toMatchObject({ok:true,foreignKeys:true});
    const db=createClient({url:`file:${path.replaceAll("\\","/")}`});
    expect((await db.execute("SELECT text FROM preservation_witness")).rows[0].text).toBe("keep learner data");
    expect((await db.execute("SELECT count(*) AS n FROM placement_responses")).rows[0].n).toBe(1);
    expect((await db.execute("SELECT count(*) AS n FROM placement_profiles")).rows[0].n).toBe(15);
    db.close();
  }finally{repo.close();await rm(dir,{recursive:true,force:true,maxRetries:2,retryDelay:50}).catch(error=>{if(error.code!=="EBUSY")throw error;});}
});
it("roundtrips the completed session, responses and profiles after starting a retake",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"placement-history-"));const repo=await openRepository(join(dir,"history.db"));
  try{
    let state=startDiagnostic(createDefaultState());
    while(currentDiagnostic(state)!.status==="active"){
      const session=currentDiagnostic(state)!;const item=getDiagnosticItem(session.currentItemId!)!;
      if(item.kind==="code"){
        const files=diagnosticDraft(session,item).sourceFiles;
        const request={type:"run" as const,requestId:crypto.randomUUID(),exerciseId:item.id,graderId:item.graderId!,files};
        const result=aggregateResult(request,{executionOk:true,tests:getGrader(item.id,item.graderId!)!.requiredTests.map((id:string)=>({id,name:id,passed:false,required:true,detail:"Incorrect return"}))});
        state=recordDiagnosticAttempt(state,session.id,item.id,request.requestId,files,result);
      }
      state=submitDiagnostic(state,session.id,item.id,{requestId:crypto.randomUUID(),skip:item.kind==="short"});
    }
    const previous=structuredClone(currentDiagnostic(state)!);
    state=startDiagnostic(state,new Date(),true);
    await repo.save({state,requestId:crypto.randomUUID(),revision:0,learningMode:true,operation:"save"});
    const loaded=(await repo.load()).state;
    expect(loaded.diagnostic.sessions).toHaveLength(2);
    expect(loaded.diagnostic.sessions![0]).toEqual(previous);
    expect(currentDiagnostic(loaded)!.status).toBe("active");
    expect(currentDiagnostic(loaded)!.responses).toEqual([]);
    expect(await repo.health()).toMatchObject({ok:true,foreignKeys:true});
    const snapshot=await repo.load();
    snapshot.state.diagnostic.sessions![0].version="1.0.0";
    await repo.save({state:snapshot.state,requestId:crypto.randomUUID(),revision:snapshot.revision,learningMode:true,operation:"save"});
    const legacy=(await repo.load()).state.diagnostic.sessions![0];
    expect(legacy.legacy).toBe(true);
    expect(legacy.responses).toEqual(previous.responses);
    expect(legacy.attempts).toEqual(previous.attempts);
    expect(legacy.profile.every(p=>p.evidenceCount===0)).toBe(true);
  }finally{repo.close();await rm(dir,{recursive:true,force:true,maxRetries:2,retryDelay:50}).catch(error=>{if(error.code!=="EBUSY")throw error;});}
});
