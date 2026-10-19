import type { ActionSummary, BehaviorLabel, HeadScore } from "./types.js";

export interface LoopDetectorConfig {
  window: number;
  maxRepeats: number;
}

export const DEFAULT_LOOP_CONFIG: LoopDetectorConfig = {
  window: 12,
  maxRepeats: 2,
};

function fingerprint(a: ActionSummary): string {
  return `${a.toolName}::${(a.argsPreview ?? "").slice(0, 200)}`;
}

function nearEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (shorter.length === 0) return false;
  return longer.includes(shorter) || levenshteinRatio(a, b) > 0.85;
}

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return 1 - dp[n]! / Math.max(m, n);
}

export interface BehaviorFeatures {
  repeats: number;
  oscillating: boolean;
  highVolumeLowProgress: boolean;
  contextThrashing: boolean;
  label: BehaviorLabel;
  confidence: number;
}

/** Detect loop / waste / distraction from recent session actions. */
export function detectBehavior(
  actions: ActionSummary[],
  config: LoopDetectorConfig = DEFAULT_LOOP_CONFIG,
): BehaviorFeatures {
  const window = actions.slice(-config.window);
  if (window.length < 2) {
    return {
      repeats: 0,
      oscillating: false,
      highVolumeLowProgress: false,
      contextThrashing: false,
      label: "progressing",
      confidence: 0.6,
    };
  }

  const fps = window.map(fingerprint);
  let maxRepeats = 1;
  const counts = new Map<string, number>();
  for (const fp of fps) {
    let matched = fp;
    for (const key of counts.keys()) {
      if (nearEqual(key, fp)) {
        matched = key;
        break;
      }
    }
    const c = (counts.get(matched) ?? 0) + 1;
    counts.set(matched, c);
    maxRepeats = Math.max(maxRepeats, c);
  }

  let oscillating = false;
  if (fps.length >= 4) {
    for (let i = 0; i < fps.length - 3; i++) {
      if (
        nearEqual(fps[i]!, fps[i + 2]!) &&
        nearEqual(fps[i + 1]!, fps[i + 3]!) &&
        !nearEqual(fps[i]!, fps[i + 1]!)
      ) {
        oscillating = true;
        break;
      }
    }
  }

  const edits = window.filter(
    (a) =>
      /edit|write|apply|patch|strreplace/i.test(a.toolName) ||
      a.outcome === "ok",
  ).length;
  const reads = window.filter((a) =>
    /read|grep|search|glob|cat|ls/i.test(a.toolName),
  ).length;
  const highVolumeLowProgress =
    window.length >= Math.min(config.window, 8) && edits === 0 && reads >= 4;

  const readSources = window
    .filter((a) => /read|cat/i.test(a.toolName))
    .map((a) => a.argsPreview ?? "");
  const uniqueReads = new Set(readSources.filter(Boolean));
  const contextThrashing =
    readSources.length >= 4 &&
    uniqueReads.size > 0 &&
    uniqueReads.size <= Math.ceil(readSources.length / 3) &&
    edits === 0;

  let label: BehaviorLabel = "progressing";
  let confidence = 0.55;

  if (maxRepeats > config.maxRepeats || oscillating) {
    label = "looping";
    confidence = Math.min(0.95, 0.7 + maxRepeats * 0.05);
  } else if (contextThrashing || highVolumeLowProgress) {
    label = "distracted";
    confidence = 0.8;
  } else if (window.length >= 6 && edits === 0) {
    label = "stalled";
    confidence = 0.7;
  }

  return {
    repeats: maxRepeats,
    oscillating,
    highVolumeLowProgress,
    contextThrashing,
    label,
    confidence,
  };
}

export function behaviorToHeadScore(features: BehaviorFeatures): HeadScore {
  return {
    label: features.label,
    confidence: features.confidence,
    distribution: {
      [features.label]: features.confidence,
    },
  };
}
