import type { AggregateMode, CardType, Team } from "./types";

export const DEFAULT_WEIGHTS = {
  correct: 1.0,
  opponent: -1.0,
  neutral: -0.3,
  assassin: -10.0,
};

export function scoreReveal(card: CardType, activeTeam: Team, w = DEFAULT_WEIGHTS): number {
  if (card === activeTeam) return w.correct;
  if (card === "ASSASSIN") return w.assassin;
  if (card === "RED" || card === "BLUE") return w.opponent;
  return w.neutral;
}

export function aggregate(scores: number[], mode: AggregateMode, lambdaStd: number = 0.7): number {
  if (!scores.length) return -9999;

  const sorted = [...scores].sort((a, b) => a - b);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

  if (mode === "mean") return mean;
  if (mode === "p10") {
    const idx = Math.floor(0.1 * (sorted.length - 1));
    return sorted[idx];
  }
  // mean_minus_lambda_std
  const variance = scores.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / scores.length;
  const std = Math.sqrt(variance);
  return mean - lambdaStd * std;
}
