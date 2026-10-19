import type { SessionTraceEntry } from "@decide-router/core";

export interface ThresholdFit {
  head: string;
  /** Suggested min confidence for auto-act. */
  minConfidence: number;
  samples: number;
  accuracyAtThreshold: number;
}

/**
 * Fit confidence thresholds per decision head from logged traces.
 * Simple grid search maximizing agreement with policy-final actions.
 */
export function fitThresholds(
  traces: SessionTraceEntry[],
  head = "verdict",
): ThresholdFit {
  const samples = traces.filter((t) => t.scores?.heads[head]);
  if (!samples.length) {
    return {
      head,
      minConfidence: 0.72,
      samples: 0,
      accuracyAtThreshold: 0,
    };
  }

  let best = { threshold: 0.72, accuracy: 0 };

  for (let t = 0.5; t <= 0.95; t += 0.05) {
    let correct = 0;
    for (const s of samples) {
      const score = s.scores!.heads[head]!;
      const conf = score.confidence;
      // Simulate: high conf → trust model label; else ask
      const predicted =
        conf >= t ? (score.label as string) : "ask";
      const actual = s.verdict.action;
      if (predicted === actual || (predicted === "allow" && actual === "rewrite")) {
        correct++;
      }
    }
    const accuracy = correct / samples.length;
    if (accuracy >= best.accuracy) {
      best = { threshold: t, accuracy };
    }
  }

  return {
    head,
    minConfidence: Number(best.threshold.toFixed(2)),
    samples: samples.length,
    accuracyAtThreshold: Number(best.accuracy.toFixed(3)),
  };
}
