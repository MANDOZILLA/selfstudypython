import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base=process.env.STUDIO_URL||"http://localhost:3016";
assert.equal(new URL(base).port,"3016","Use the isolated placement test server on port 3016 with a temporary database.");
const browser=await chromium.launch({channel:"chrome",headless:true});
await mkdir("test-results",{recursive:true});
const answers={"variables-read":"23 str","strings-hard":"False name = name.strip()","conditionals-hard":"False","loops-hard":"3","functions-hard":"5 6","collections-hard":"[1, 2]","exceptions-read":"ValueError oops","reasoning-read":"[1, 2]","variables-easy":"4","strings-easy":"yth","conditionals-easy":"False","loops-easy":"6","functions-easy":"None","collections-easy":"0","reasoning-easy":"no"};
const sources={variables:"def solve(value): return int(value)*2",strings:"def solve(value): return value.strip().lower().replace(' ', '-')",conditionals:"def solve(value): return 0 if value>=50 else 3 if value>=20 else 5",loops:"def solve(value): return sum(sum(row) for row in value)",functions:"def solve(value): return value[0]+sum(value[1])",collections:"def solve(value):\n    groups={}\n    for name,tag in value: groups.setdefault(name,set()).add(tag)\n    return {name:len(tags) for name,tags in groups.items()}",exceptions:"def solve(value):\n    result=[]\n    for text in value:\n        try: result.append(int(text))\n        except ValueError: continue\n    return result",reasoning:"def solve(value): return [value]"};
try{
  for(const [name,viewport] of [["desktop",{width:1280,height:850}],["mobile",{width:375,height:812}]]){
    const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];
    let expectedLoadFailure=false;const expectedErrors=[];
    page.on("pageerror",e=>(expectedLoadFailure?expectedErrors:errors).push(e.message));page.on("console",m=>{if(m.type()==="error")(expectedLoadFailure?expectedErrors:errors).push(m.text());});
    await page.goto(base);
    const reset=await page.evaluate(async()=>{
      const snapshot=await (await fetch("/api/learner",{headers:{"X-Coding-School":"local"}})).json();
      return (await fetch("/api/learner",{method:"PUT",headers:{"Content-Type":"application/json","X-Coding-School":"local"},body:JSON.stringify({operation:"save",revision:snapshot.revision,requestId:crypto.randomUUID(),learningMode:true,state:{version:2,dashboard:{activeTab:"overview"},diagnostic:{completed:false,completedAt:null},attempts:[],missionRuns:[],mastery:{},reviewSchedule:{},portfolio:[]}})})).status;
    });assert.equal(reset,200);
    await page.goto(base);await page.getByRole("heading",{name:"Establish your placement baseline"}).waitFor();
    await page.screenshot({path:`test-results/baseline-today-${name}.png`,fullPage:true});
    await page.getByRole("button",{name:"Start placement baseline"}).click();
    const snapshot=()=>page.evaluate(async()=>await (await fetch("/api/learner",{headers:{"X-Coding-School":"local"}})).json());
    const waitSaved=async predicate=>{for(let n=0;n<150;n++){if(predicate(await snapshot()))return;await page.waitForTimeout(100);}throw new Error("Expected SQLite save did not arrive.");};
    let count=0;
    while(true){
      const current=(await snapshot()).state.diagnostic.sessions.at(-1);if(current.status==="completed")break;
      const item=current.currentItemId;const code=item.endsWith("-code");
      await page.getByText(`Question ${count+1}, at least 12; up to 25`,{exact:true}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: question ${count+1} overflow`);
      if(code){
        const toggle=page.getByRole("button",{name:"Use plain text",exact:true});if(await toggle.isVisible())await toggle.click();
        const editor=page.getByRole("textbox",{name:"Python code",exact:true});
        if(count===1){
          const before=(await snapshot()).state.diagnostic.sessions.at(-1);
          expectedLoadFailure=true;
          await context.route("**/pyodide/pyodide.mjs",route=>route.abort("failed"));
          await page.getByRole("button",{name:"Run checks",exact:true}).click();
          await page.getByRole("alert").filter({hasText:"Not assessed"}).waitFor({timeout:30000});
          assert.ok(await page.getByRole("button",{name:"Record attempt & continue"}).isDisabled());
          const failed=(await snapshot()).state.diagnostic.sessions.at(-1);
          assert.deepEqual(failed.attempts,before.attempts);assert.deepEqual(failed.responses,before.responses);assert.deepEqual(failed.profile,before.profile);
          await page.screenshot({path:`test-results/baseline-unavailable-${name}.png`,fullPage:true});
          await context.unroute("**/pyodide/pyodide.mjs");expectedLoadFailure=false;
          await context.route("**/python-worker.js",route=>route.fulfill({contentType:"text/javascript",body:`self.onmessage=({data:r})=>{const valid={requestId:r.requestId,exerciseId:r.exerciseId,graderId:r.graderId,graderVersion:'1.1.0',executionOk:true,passed:true,score:1,stdout:'',stderr:'',tests:['behavior','edges','contract'].map(id=>({id,name:id,required:true,passed:true,detail:''}))};self.postMessage({...valid,requestId:'stale-request'});self.postMessage({...valid,graderVersion:'old-version'});self.postMessage({...valid,tests:[]});self.postMessage({type:'progress',requestId:r.requestId,exerciseId:r.exerciseId,graderId:r.graderId,phase:'running'});};`}));
          await page.getByRole("button",{name:"Run checks",exact:true}).click();
          await page.locator(".run-status").filter({hasText:"Running checks"}).waitFor();
          const stale=(await snapshot()).state.diagnostic.sessions.at(-1);
          assert.deepEqual(stale.attempts,before.attempts);assert.deepEqual(stale.responses,before.responses);assert.deepEqual(stale.profile,before.profile);
          assert.ok(await page.getByRole("button",{name:"Record attempt & continue"}).isDisabled());
          await page.getByRole("button",{name:"Stop Python",exact:true}).click();await context.unroute("**/python-worker.js");
        }
        if(name==="mobile" && count===1){
          await editor.fill("def solve(value): return 'wrong'");
          await page.getByRole("button",{name:"Run checks",exact:true}).click();
          await page.locator(".run-status").filter({hasText:"Needs changes"}).waitFor();
          await page.locator(".baseline-help summary").click();await page.getByRole("button",{name:"Reveal hint",exact:true}).click();
          await page.getByLabel("I used external help, including AI").check();
        }
        await editor.fill(sources[item.slice(0,-5)]||"def solve(value): pass");
        await waitSaved(data=>data.state.diagnostic.sessions.at(-1).drafts[item]?.sourceFiles["main.py"]===(sources[item.slice(0,-5)]||"def solve(value): pass"));
        if(count===1){
          await page.reload();await page.getByText(`Question ${count+1}, at least 12; up to 25`,{exact:true}).waitFor();
          const toggle=page.getByRole("button",{name:"Use plain text",exact:true});if(await toggle.isVisible())await toggle.click();
          assert.equal(await page.getByRole("textbox",{name:"Python code",exact:true}).inputValue(),sources.strings);
          if(name==="mobile")assert.equal((await snapshot()).state.diagnostic.sessions.at(-1).drafts[item].hintsUsed,1);
        }
        await page.getByRole("button",{name:"Run checks",exact:true}).click();
        await page.locator(".run-status").filter({hasText:/Passed|Needs changes|Couldn't run/}).waitFor({timeout:30000});
        await page.getByRole("button",{name:"Record attempt & continue"}).click();
      }else{
        const answer=answers[item];
        if(answer){await page.getByLabel("Your answer",{exact:true}).fill(answer);
          if(count===0){await waitSaved(data=>data.state.diagnostic.sessions.at(-1).drafts["variables-read"]?.answer==="23 str");await page.reload();await page.getByLabel("Your answer",{exact:true}).waitFor();assert.equal(await page.getByLabel("Your answer",{exact:true}).inputValue(),"23 str");
            await page.getByRole("button",{name:"Save & return to Today"}).click();await page.getByRole("button",{name:"Resume placement baseline"}).waitFor();await page.goBack();await page.getByLabel("Your answer",{exact:true}).waitFor();assert.equal(await page.getByLabel("Your answer",{exact:true}).inputValue(),"23 str");}
          await page.getByRole("button",{name:"Save answer & continue"}).click();
        }else await page.getByRole("button",{name:"I don’t know yet"}).click();
      }
      count++;await waitSaved(data=>data.state.diagnostic.sessions.at(-1).responses.length===count);assert.ok(count<=25);
    }
    assert.ok(count>=12);const saved=(await snapshot()).state;const session=saved.diagnostic.sessions.at(-1);
    assert.ok(session.responses.filter(r=>r.attemptId!==null).length>=5);assert.deepEqual(saved.mastery,{});assert.equal(saved.missionRuns.length,0);
    if(name==="mobile"){
      const stringTrials=session.attempts.filter(a=>a.itemId==="strings-code");
      assert.deepEqual(stringTrials.map(a=>a.passed),[false,true]);
      const stringProfile=session.profile.find(p=>p.skillId==="strings");
      assert.equal(stringProfile.confidence,"Conflicting");
      assert.deepEqual(stringProfile.attemptIds,stringTrials.map(a=>a.id));
      assert.equal(session.responses.find(r=>r.itemId==="strings-code").hintsUsed,1);
    }
    await page.getByRole("heading",{name:"Your observed starting point.",exact:true}).waitFor();
    await page.screenshot({path:`test-results/baseline-results-${name}.png`,fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: result overflow`);
    await page.getByRole("button",{name:"Start a new placement baseline",exact:true}).click();
    await page.getByText("Question 1, at least 12; up to 25",{exact:true}).waitFor();
    await waitSaved(data=>data.state.diagnostic.sessions.length===2);
    const retake=(await snapshot()).state.diagnostic.sessions.at(-1);
    await page.getByRole("combobox",{name:"Placement session"}).selectOption(session.id);
    await page.getByText("Historical session · read-only",{exact:false}).waitFor();
    assert.equal(await page.getByLabel("Your answer",{exact:true}).count(),0);
    await page.locator(".baseline-skill summary").first().click();
    await page.getByText(`Response ID:`,{exact:false}).first().waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: history overflow`);
    await page.screenshot({path:`test-results/baseline-history-${name}.png`,fullPage:true});
    await page.getByRole("combobox",{name:"Placement session"}).selectOption(retake.id);
    await page.getByLabel("Your answer",{exact:true}).fill("retake draft survives history");
    await waitSaved(data=>data.state.diagnostic.sessions.at(-1).drafts["variables-read"]?.answer==="retake draft survives history");
    await page.reload();await page.getByLabel("Your answer",{exact:true}).waitFor();
    assert.equal(await page.getByLabel("Your answer",{exact:true}).inputValue(),"retake draft survives history");
    assert.deepEqual((await snapshot()).state.diagnostic.sessions[0],session);
    await page.getByRole("combobox",{name:"Placement session"}).selectOption(session.id);
    await page.getByRole("button",{name:"See recommendation on Today"}).click();
    await page.getByRole("button",{name:"Resume placement baseline"}).waitFor();
    await page.getByRole("button",{name:"Resume placement baseline"}).click();
    await page.getByRole("combobox",{name:"Placement session"}).selectOption(session.id);
    await page.getByRole("button",{name:"Start recommended mission"}).click();await page.getByRole("button",{name:"Continue to Learn"}).waitFor();
    assert.deepEqual(errors,[],`${name}: browser console errors`);
    console.log(`PASS ${name}: Dashboard → ${count} adaptive mixed items → profile → retake/history → Today → mission; infrastructure retry, stale/version/malformed rejection, conceptual/code reload, Back, overflow and console verified. Expected load-failure console events: ${expectedErrors.length}.`);
    await context.close();
  }
}finally{await browser.close();}
