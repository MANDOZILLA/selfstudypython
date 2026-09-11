export type EvidenceKind = "quiz" | "exercise" | "project" | "assessment";

export type MasteryRecord = {
  skillId: string;
  score: number;
  confidence: number;
  independentEvidence: number;
  totalEvidence: number;
  lastDemonstratedAt: string | null;
};

export type EvidenceInput = {
  kind: EvidenceKind;
  score: number;
  hintsUsed: number;
  aiAssisted: boolean;
  independent: boolean;
  completedAt: string;
};

export type ReviewSchedule = {
  dueAt: string;
  reason: "weak-skill" | "practice" | "retrieval";
};

export type DiagnosticPrompt = {
  id: string;
  skillId: string;
  difficulty: number;
  kind: "concept" | "coding";
};

export type DiagnosticResponse = {
  promptId: string;
  skillId: string;
  correct: boolean;
};

const gainCap: Record<EvidenceKind, number> = {
  quiz: 6,
  exercise: 12,
  project: 22,
  assessment: 18,
};

export function updateMastery(current: MasteryRecord, evidence: EvidenceInput): MasteryRecord {
  const hintMultiplier = Math.max(0.35, 1 - evidence.hintsUsed * 0.14);
  const assistanceMultiplier = evidence.aiAssisted ? 0.7 : 1;
  const independenceMultiplier = evidence.independent ? 1 : 0.8;
  const rawGain = gainCap[evidence.kind] * evidence.score * hintMultiplier * assistanceMultiplier * independenceMultiplier;
  const needsIndependentProof = current.independentEvidence < 3;
  const ceiling = needsIndependentProof ? 85 : 100;
  const score = Math.min(ceiling, Math.round((current.score + rawGain) * 10) / 10);
  const confidenceGain = evidence.independent ? 0.16 : 0.08;

  return {
    ...current,
    score,
    confidence: Math.min(1, Math.round((current.confidence + confidenceGain) * 100) / 100),
    independentEvidence: current.independentEvidence + (evidence.independent ? 1 : 0),
    totalEvidence: current.totalEvidence + 1,
    lastDemonstratedAt: evidence.completedAt,
  };
}

export function scheduleReview(mastery: MasteryRecord, now: Date): ReviewSchedule {
  const days = mastery.score < 50 ? 1 : mastery.score < 70 ? 3 : mastery.score < 85 ? 8 : 21;
  const reason = mastery.score < 50 ? "weak-skill" : mastery.score < 85 ? "practice" : "retrieval";
  const dueAt = new Date(now);
  dueAt.setUTCDate(dueAt.getUTCDate() + days);
  return { dueAt: dueAt.toISOString(), reason };
}

export function chooseDiagnosticPrompt(
  prompts: DiagnosticPrompt[],
  responses: DiagnosticResponse[],
): DiagnosticPrompt | undefined {
  const answered = new Set(responses.map((response) => response.promptId));
  const unanswered = prompts.filter((prompt) => !answered.has(prompt.id));
  if (!unanswered.length) return undefined;

  const skillOrder = [...new Set(prompts.map((prompt) => prompt.skillId))];
  for (const skillId of skillOrder) {
    const evidence = responses.filter((response) => response.skillId === skillId);
    if (!evidence.length) return unanswered.find((prompt) => prompt.skillId === skillId);
    const hasConcept = evidence.some((response) => prompts.find((prompt) => prompt.id === response.promptId)?.kind === "concept");
    const hasCoding = evidence.some((response) => prompts.find((prompt) => prompt.id === response.promptId)?.kind === "coding");
    const allCorrect = evidence.every((response) => response.correct);
    if (!(evidence.length >= 2 && hasConcept && hasCoding && allCorrect)) {
      const nextForSkill = unanswered.find((prompt) => prompt.skillId === skillId);
      if (nextForSkill) return nextForSkill;
    }
  }

  return unanswered[0];
}
