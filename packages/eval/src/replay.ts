import {
  DecideEngine,
  normalizeEvent,
  type SessionTraceEntry,
  type Verdict,
  type VerdictAction,
} from "@decide-router/core";
import { HeuristicBackend } from "@decide-router/backends";
import {
  DeterministicPolicyEngine,
  DEFAULT_POLICY,
} from "@decide-router/policy";
import type { SafetyFixture } from "./fixtures/safety.js";

export interface ReplayResult {
  id: string;
  expected: VerdictAction;
  actual: VerdictAction;
  pass: boolean;
  verdict: Verdict;
}

export function createEvalEngine(): DecideEngine {
  return new DecideEngine({
    backend: new HeuristicBackend(),
    policy: new DeterministicPolicyEngine(DEFAULT_POLICY),
    config: {
      failClosed: true,
      loopDetector: { window: 12, maxRepeats: 2 },
      actionGateMinConfidence: 0.72,
      midCascade: true,
    },
  });
}

/** Replay safety fixtures through the engine (offline, heuristic). */
export async function replaySafetyFixtures(
  fixtures: SafetyFixture[],
  engine: DecideEngine = createEvalEngine(),
): Promise<ReplayResult[]> {
  const results: ReplayResult[] = [];
  for (const f of fixtures) {
    const verdict = await engine.decide(normalizeEvent(f.event));
    const actual = verdict.action === "rewrite" ? "allow" : verdict.action;
    results.push({
      id: f.id,
      expected: f.expect,
      actual,
      pass: actual === f.expect,
      verdict,
    });
  }
  return results;
}

/** Replay logged session traces and compare actions. */
export async function replayTraces(
  traces: SessionTraceEntry[],
  engine: DecideEngine = createEvalEngine(),
): Promise<ReplayResult[]> {
  const results: ReplayResult[] = [];
  for (const t of traces) {
    const verdict = await engine.decide(t.request);
    const expected = t.verdict.action === "rewrite" ? "allow" : t.verdict.action;
    const actual = verdict.action === "rewrite" ? "allow" : verdict.action;
    results.push({
      id: t.id,
      expected,
      actual,
      pass: actual === expected,
      verdict,
    });
  }
  return results;
}
