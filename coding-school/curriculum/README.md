# Project-led curriculum

`project-led.txt` is the curriculum supplied by the learner. The Curriculum view reads `project-led.json`, generated from that text with:

```powershell
node scripts/sync-project-led-curriculum.mjs
```

The script checks for 17 numbered sections, nine phases, and twenty units. Existing graded workbench missions are separate practice exercises; they do not yet implement every unit in this roadmap.
