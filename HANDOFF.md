# Continue the Workbench School bug hunt

## User request and current stopping point

The user asked: "The newest version of the codebase is on github i want you to bug hunt it and make sure it is up to your standards. also use sub agents where it makes sense dynamically switch the model for sub agents to match the difficulty of the task."

The user subsequently ran low on usage and asked for this detailed handoff to another equally capable terminal coding agent. Continue the existing work; do not restart the audit from scratch. Finish fixes, review the combined diff, and verify the product. Do not claim the current tree is fully verified. No commit, push, merge, or deployment has been performed.

No Obsidian vault was accessed or modified. I do not have a verified Obsidian vault path to provide.

## Exact repository/checkouts

- GitHub: https://github.com/MANDOZILLA/selfstudypython.git
- Original user workspace: `C:\Users\whyhe\Documents\ChatGPT\Self Studying Python`
- **WORK HERE:** `C:\Users\whyhe\Documents\ChatGPT\selfstudypython-bug-hunt`
- Application directory: `C:\Users\whyhe\Documents\ChatGPT\selfstudypython-bug-hunt\coding-school`
- Working branch: `codex/bug-hunt-latest`
- Based on remote branch: `origin/vesper/selfstudypython-final`
- Audited base commit: `1639ae08575ef8af6dcdd819479c6d2958ed8345`
- Base subject: `UI polish: self-assessment/tutor styles, workbench a11y, mission attempt recording, fairer diagnostic grading`
- When fetched on September 15, this branch was newer than `origin/main` (`f79a41b`). Original local main matched origin/main. Current environment date at handoff is September 17: fetch and inspect whether the remote has advanced, but do not blindly pull over this dirty worktree or discard the audit changes.
- Original workspace had unrelated untracked `coding-school/.next-placement/` and `coding-school/.next-sqlite-review/`. They were left alone. A separate worktree was created specifically to preserve them.
- **All audit changes are uncommitted, including new regression tests.** Read `git status` and `git diff` before doing anything destructive.

## Environment/rules

- Windows, PowerShell, Node observed as v24.14.0.
- Read `C:\Users\whyhe\AGENTS.md` and repository/application `AGENTS.md`.
- Next.js is 16.3.4, React 19.2.8, Vitest 5.0.0, TypeScript 5, libsql/Drizzle SQLite, Zod 4, Monaco, Pyodide.
- Read relevant Next guides in `coding-school/node_modules/next/dist/docs/` before Next changes. Do not assume old framework APIs.
- Application dependencies were installed with `npm ci` inside `coding-school`. Root also has an old duplicated package manifest/lockfile; the actual app is nested.
- Do not overwrite learner data. Verification must use a temporary database through `CODING_SCHOOL_DB_PATH`.
- Use root-cause debugging: reproduce, add regression coverage, fix, verify. Avoid speculative refactors.
- User authorized subagents/model selection. Previous split: high-effort GPT-6 Astra for persistence/concurrency; medium-effort GPT-5.6 Sol for grading and UI. Use cheaper models for bounded searches and stronger ones for cross-cutting diagnosis as useful. Those previous agents were interrupted for a stable handoff; do not assume they will continue.
- No new integration or deployment is needed. Vercel is not part of this local-app task. Vercel CLI was reported absent.

## Product structure and expected behavior

Workbench School/Coding School is a single-learner Python studio: adaptive placement diagnostic, guided missions, checkpoint assessments, portfolio projects, browser IDE running actual Python through Pyodide, local/offline tutor with optional OpenRouter provider, skill evidence and recommendations.

- UI: `coding-school/app/studio/`, entry `app/page.tsx`.
- Curriculum: `curriculum/`; grading and evidence: `lib/` and shipped JS under `public/grading/`.
- Durable state: SQLite `.data/coding-school.db`; browser localStorage is a write-through cache/offline fallback.
- State API: `GET`/`PUT /api/state` with optimistic revision checks; conflicting saves return 409. User work must survive offline changes, refreshes, concurrent tabs, malformed input, and corrupt durable data.
- Tutor endpoint: `app/api/tutor/route.ts`; provider `lib/tutor-provider.ts`; deterministic fallback `lib/tutor.ts`.
- Browser worker and assets are local; offline pandas/NumPy and Monaco are intended to work without outside network requests.
- No login/multi-user isolation. Default dev/start binding was tightened to 127.0.0.1 accordingly.

## Implemented fixes and evidence

### 1. Persistence/data-loss/concurrency (strongest completed review)

Files: `app/api/state/route.ts`, `db/client.ts`, `tests/state-api.test.ts`, `tests/sqlite-revision.test.ts`, `tests/sqlite.test.ts` (all under coding-school).

Reproduced issues:

- PUT accepted `{}` or arbitrary objects as state; migration normalized them into an empty profile and overwrote saved work at the current revision.
- Snapshot reads fetched revision and content through independent queries, so a concurrent writer could make a response report revision 1 with revision 2's content.
- Conflict response read state after rolling back/releasing its transaction, exposing the same consistency risk.
- Malformed durable entity JSON could be swallowed by the older loader and represented as successful default state.

Changes:

- Require complete current-version state envelope, safe nonnegative revision integer, and reject payloads whose migration silently drops top-level records.
- Read state/revision with an atomic libsql read batch.
- Capture 409 conflict state inside the existing transaction before rollback.
- Durable JSON parsing errors now surface instead of returning a successful empty snapshot.

Agent reported **55 targeted tests passing**, focused lint passing. Earlier test typing error at sqlite-revision.test.ts:70 was fixed. Diagnostic parity was specifically checked: migrateState derives diagnostic completion/date from sessions when omitted; added roundtrip tests with out-of-order completed sessions, active retake, active-only sessions, and conflict reads.

### 2. Grading/curriculum integrity

Files: `lib/assessment-evidence.ts`, `lib/assessment-grading.ts`, `lib/curriculum.ts` and corresponding tests.

- `deriveSkillStatus` previously accepted mixed-skill records and could complete/master one skill using another skill's evidence. Now filters by requested skillId.
- Foundations written-answer grader passed explicitly negated claims such as "error count is not 2" or "does not skip". Added scoped negation handling and tests for contractions, adverbs, correct nearby negatives, and "not three; it is 2".
- Curriculum schema accepted duplicate skill IDs and prerequisite cycles. Added duplicate detection and DFS cycle validation.

Agent reported initial batches of 100 and 121 tests passing; after follow-up negation corrections, **93 focused tests passed**, lint and diff checks passed. Review the heuristics for actual learner wording; this remains regex-based grading, not a general semantic language evaluator.

### 3. UI / assessment evidence (latest edits need fresh verification)

- `app/page.tsx`: loading-state main now has `id="main-content"` so the skip link has a target. New `tests/page-loading.test.tsx`.
- `app/studio/assessment-workbench.tsx`: editing assessed code previously retained grade evidence from the old source. New `updateAssessmentCodeDraft` clears gradeResult/grading/saved; both Monaco and plain textarea call updateCode, which cancels and clears the in-flight runner. Regression in `tests/assessment-run-request.test.ts`.
- **No final agent verification report was received for these latest edits.** Inspect cancellation callback behavior and test an actual browser edit-after-pass flow.
- Agent also noticed assistance checkboxes use `onChange={() => ... true}` and cannot be unchecked. Not changed. Determine whether this is intentional permanent assistance tracking before calling it a bug; avoid enabling evidence laundering.

### 4. Tutor safety/response limits (latest edits need fresh verification)

Files: `lib/tutor-provider.ts`, `tests/tutor.test.tsx`.

Found arbitrary external model-generated reference URLs were accepted and rendered as "See also" links even though tutor contract says references stay inside the app. Also maxBytes used JS character length after buffering the whole response, not byte count.

Current edits:

- isSafeAppReference allows # fragments and single-leading-slash local paths, rejects obvious external/protocol-relative paths.
- Checks provider references and ctx.taskUrl; malformed provider output falls back.
- readBoundedText reads the response stream, counts actual bytes, cancels at limit, decodes incrementally.
- Sanitizes invalid option values with positiveInteger.
- Tests added for external/protocol-relative links, external task URL, UTF-8 byte limit.

**No final test report received for these edits. Review before accepting.** Specific follow-ups:

- An invalid taskUrl currently makes the provider return malformed, but the deterministic fallback still receives the same ctx.taskUrl. Verify that this does not simply reproduce an unsafe link in fallback. A test that only asserts fallback source is insufficient.
- Check URL normalization edge cases (tabs/newlines/backslashes) using actual URL resolution; current regex may not cover them.
- Test streamed oversized payload cancellation, timeout during body read, empty response, malformed JSON, valid response, and no-key fallback. Do not use real provider credits/keys for unit tests.

### 5. Windows verification tooling / clean-checkout types

Files: `scripts/verify-product.mjs`, `scripts/verify-diagnostic.mjs`, `scripts/verify-missions.mjs`, `tests/worker-modules.test.ts`.

Reproduced `npm run verify:product` immediately failing with `spawn npx ENOENT`. URL.pathname also produced invalid Windows paths (`\\C:\\...`). Fixed paths with fileURLToPath and child process launch via process.execPath + installed package bin paths. Initial require.resolve('vitest/vitest.mjs') failed due package exports; final version resolves package.json and reads bin field.

Standalone diagnostic/mission --serve now launches Next via Node directly, runs prepare-editor first, and binds to 127.0.0.1. Whole verifier runs `next typegen` before tsc so LayoutProps exists on a fresh checkout. Review shutdown/error handling and --serve data isolation if extending these scripts.

**Known unfinished compatibility fix:** stricter state API rejects the browser verifiers' old empty-object resets.

- Added `scripts/verification-state.mjs` exporting `createEmptyVerificationState()` (current version 3 complete profile).
- `verify-desktop.mjs` and `verify-mobile.mjs` now import/use it.
- **`scripts/verify-missions.mjs` still calls `await putServerState({}, "resetServerState")` around line 194. Import helper and pass `createEmptyVerificationState()` instead.** This was the next concrete edit planned.
- Check other seed fixtures for complete valid current state before browser runs; do not weaken API validation to satisfy stale tests.

### 6. Dependency/startup/config/documentation

- Nested app npm audit found pinned transitive DOMPurify 3.4.8 via Monaco 0.56.0. `npm audit fix` did not fix it because Monaco pinned the version.
- Added nested package override `dompurify: 3.4.15`, updated nested lock via npm install. **Nested npm audit then reported 0 vulnerabilities.** Root duplicate dependencies were not audited/updated; do not generalize that result to root lockfile or bundled static assets without checking.
- Nested scripts dev/start now pass `--hostname 127.0.0.1` to avoid exposing unauthenticated learner data on LAN by default.
- `next.config.ts` now sets `turbopack.root: __dirname` after build warned about multiple root/nested lockfiles.
- Root `npm run dev` reproduced a missing `scripts/prepare-editor.mjs` failure: actual app is nested. Root package scripts now delegate with `npm --prefix coding-school run ...`; root predev/prebuild removed because nested scripts run them. Added root verify:product forwarding. **Delegated root commands not yet reverified.** Install nested dependencies per README.
- Root README replaced stale template with actual setup/verification/data directions.
- Nested README originally contained substantial feature documentation. During final handoff preparation it was restored from HEAD (preserving that content) with only targeted fixes: Node 20.9+ minimum, correct clone subdirectory, local SQLite wording, server API description. Review remaining claims (e.g. runtime download wording) rather than replacing its feature documentation.
- npm warned ESLint 9.39.5 is no longer supported. This was identified as a lifecycle/deprecation warning, not a failed lint run. No major ESLint migration attempted.

## Verification truth: what passed and what did not

- npm ci succeeded in nested app.
- Nested dependency audit after override: 0 vulnerabilities.
- A full `npm run build` completed successfully; `coding-school/build.log` has output. **It predates the final UI/tutor/config edits, so rebuild.**
- Full lint completed with exit 0 at an earlier point; it predates final edits.
- Initial tsc errors: LayoutProps absent before Next typegen/build; sqlite test overload typing. Both were addressed, but final clean tsc still needs running.
- Last whole-product run: **763 passed / 1 failed (764 tests, 44 files)**. Failure was the grading agent's newly added "unrelated negation does not hide a correct claim" red regression while it was editing. Agent subsequently fixed it and passed focused tests. **Full suite has not rerun on the final combined tree.**
- Earlier full run: 753 passed, 2 deliberate persistence regressions failed, worker-modules test failed to load due Windows pathname. All subsequently addressed in focused work.
- `coding-school/verification.log` is the stale failing full run; do not present it as final evidence.
- **No full desktop/mobile/Pyodide browser verification completed in this audit.** Whole-product runs stopped at stage 1, so stages 2–15 did not finish. Browser verification is essential remaining work.
- Whole verifier reported learner DB absent and unchanged in completed runs. No production user database was intentionally opened or modified.

## Next actions, in order

1. Read current git diff/status and this document; preserve all uncommitted work. Check remote advancement without overwriting local changes.
2. Complete mission verifier's empty-state-helper integration noted above.
3. Review and run focused tests for latest UI/tutor changes; fix the fallback URL gap if reproduced. Review all persistence/grading changes as a coherent diff.
4. Run the full test suite on a stable tree (no concurrent test-writing agents), typegen/tsc, lint, build. Do not suppress failures or change expectations just to get green.
5. Run full `npm run verify:product` and fix actual failures. It starts an isolated production server on port 3100 with temporary SQLite and OPENROUTER_API_KEY stripped.
6. Complete desktop/mobile browser flows and real Pyodide runs, including assessment edit-after-pass, reload persistence, conflict/offline handling, mission progress and grader evidence, offline pandas, tutor fallback/learning mode, portfolio ZIP integrity. Check browser console/page errors and horizontal overflow.
7. Recheck nested npm audit, diff whitespace, changed/untracked files. Preserve relevant regression tests/helper. build.log and verification.log are scratch evidence, not source files to blindly commit.
8. Produce a concise findings/fixes/verification summary with honest remaining limitations. No blanket guarantee of being bug-free. Do not automatically deploy or merge. Follow user's shipping instructions if they later request it; global AGENTS requires ship/deploy-preflight for commit-and-push/production push.

## Useful commands (PowerShell)

```powershell
Set-Location 'C:\Users\whyhe\Documents\ChatGPT\selfstudypython-bug-hunt'
git status --short
git diff --stat
git log -1

Set-Location '.\coding-school'
npm test
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
npm run lint
npm run build
npm audit
npm run verify:product *> verification.log
Get-Content verification.log -Tail 80
```

Install Playwright Chromium if missing: `npx playwright install chromium` from nested app. Individual browser scripts may reset the server they target; **do not point them at the user's live learner server**. Prefer the complete isolated verifier. Existing screenshots use `/tmp/...` paths, which may need platform-safe temp path updates on Windows if they fail. Do not kill unrelated Node processes; this machine had many before our work.

The original tool sessions were 76742 (npm ci), 52388/57576 (failed verifier runs), 54941 (tsc/lint), 31574 (successful earlier build). They had completed or had complete logs before handoff; session IDs are not reusable across terminal agents. Inspect actual processes/ports if uncertain.
