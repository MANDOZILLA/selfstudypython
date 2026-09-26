import plan from "../../curriculum/project-led.json";

const phases = plan.sections.filter(section => section.title.startsWith("PHASE "));
const guidance = plan.sections.filter(section => !section.title.startsWith("PHASE "));

function CurriculumCopy({ text }: { text: string }) {
  return <div className="curriculum-copy">{text}</div>;
}

export function ProjectLedCurriculum() {
  return <div className="project-led-curriculum">
    <section className="document curriculum-introduction">
      <span className="eyebrow">PROJECT-LED ROADMAP</span>
      <h2>{plan.title}</h2>
      <CurriculumCopy text={plan.overview} />
    </section>

    <nav className="document curriculum-phase-nav" aria-label="Curriculum phases">
      <h2>Phases</h2>
      <ol>{phases.map(phase => <li key={phase.number}><button type="button" onClick={() => document.getElementById(`curriculum-phase-${phase.number}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{phase.title.replace("PHASE ", "Phase ")}</button><span>{phase.duration}</span></li>)}</ol>
    </nav>

    {phases.map(phase => <section className="document curriculum-phase" id={`curriculum-phase-${phase.number}`} key={phase.number}>
      <div className="section-heading"><h2>{phase.title}</h2><span className="eyebrow">{phase.duration}</span></div>
      {phase.intro && <CurriculumCopy text={phase.intro} />}
      {phase.units.length > 0 && <div className="curriculum-units">{phase.units.map(unit => <details key={unit.number}>
        <summary><span>UNIT {unit.number}</span><strong>{unit.title}</strong><span aria-hidden="true">⌄</span></summary>
        <CurriculumCopy text={unit.content} />
      </details>)}</div>}
    </section>)}

    <section className="curriculum-guidance" aria-labelledby="curriculum-guidance-title">
      <h2 id="curriculum-guidance-title">How to use this curriculum</h2>
      {guidance.map(section => <details className="document" key={section.number}>
        <summary>{section.title}</summary>
        <CurriculumCopy text={section.intro} />
      </details>)}
    </section>
  </div>;
}
