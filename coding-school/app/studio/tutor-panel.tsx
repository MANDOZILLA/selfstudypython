"use client";

import { useState } from "react";
import type { TutorResponse } from "../../lib/tutor";

export interface TutorPanelProps {
  /** False in Learning (independent) Mode: the affordance is hidden entirely. */
  visible: boolean;
  taskId: string;
  taskTitle: string;
  requirements: string[];
  hints: string[];
  hintsUsed: number;
  code: string;
  execution: { status: string; kind?: string; file?: string; line?: number; message?: string } | null;
  failedTests: string[];
  taskUrl: string;
  /** Called before the request is sent so the parent permanently records AI assistance. */
  onTutorUsed: () => void;
}

type PanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; tutor: TutorResponse; source: string }
  | { status: "error"; message: string };

/** AI suggestions are always visibly labeled; the learner must verify them
 *  against the checks. Pure presentational component for testability. */
export function TutorResponseView({ tutor, source }: { tutor: TutorResponse; source?: string }) {
  return (
    <div className="tutor-response" role="status" aria-label="AI tutor suggestion">
      <p className="tutor-label">
        <strong>AI suggestion{source === "openrouter" ? " (online tutor)" : " (built-in tutor)"}</strong>
        {" — verify against the checks."}
      </p>
      <p>{tutor.summary}</p>
      {tutor.diagnosis.length > 0 && (
        <div>
          <h4>What I see</h4>
          <ul>
            {tutor.diagnosis.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {tutor.nextSteps.length > 0 && (
        <div>
          <h4>Next steps</h4>
          <ol>
            {tutor.nextSteps.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </div>
      )}
      {tutor.references.length > 0 && (
        <p className="muted">
          See also:{" "}
          {tutor.references.map((ref, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <a href={ref.url}>{ref.label}</a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

export function TutorPanel(props: TutorPanelProps) {
  const [panel, setPanel] = useState<PanelState>({ status: "idle" });
  if (!props.visible) return null;

  async function ask() {
    props.onTutorUsed();
    setPanel({ status: "loading" });
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: props.taskId,
          taskTitle: props.taskTitle,
          requirements: props.requirements,
          hints: props.hints,
          hintsUsed: props.hintsUsed,
          code: props.code,
          execution: props.execution,
          failedTests: props.failedTests,
          independentMode: false,
          taskUrl: props.taskUrl,
        }),
      });
      if (res.status === 403) {
        setPanel({ status: "error", message: "The tutor is unavailable in Learning Mode." });
        return;
      }
      if (!res.ok) {
        setPanel({ status: "error", message: "The tutor could not answer. Your code is unchanged." });
        return;
      }
      const data = (await res.json()) as { tutor?: TutorResponse; source?: string };
      if (!data.tutor) {
        setPanel({ status: "error", message: "The tutor returned an empty answer. Your code is unchanged." });
        return;
      }
      setPanel({ status: "ready", tutor: data.tutor, source: data.source ?? "deterministic" });
    } catch {
      setPanel({ status: "error", message: "Could not reach the tutor. Your code is unchanged." });
    }
  }

  return (
    <section className="tutor-section" aria-label="Tutor">
      <div className="section-heading">
        <h3>Stuck?</h3>
        <span className="muted">Asking records AI assistance for this task.</span>
      </div>
      {panel.status === "idle" && (
        <button className="secondary" onClick={ask}>
          Ask tutor
        </button>
      )}
      {panel.status === "loading" && <p className="muted" role="status">The tutor is thinking…</p>}
      {panel.status === "error" && (
        <div>
          <p className="error" role="alert">{panel.message}</p>
          <button className="secondary" onClick={ask}>
            Try again
          </button>
        </div>
      )}
      {panel.status === "ready" && (
        <div>
          <TutorResponseView tutor={panel.tutor} source={panel.source} />
          <button className="secondary" onClick={ask}>
            Ask again
          </button>
        </div>
      )}
    </section>
  );
}
