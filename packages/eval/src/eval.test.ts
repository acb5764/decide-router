import { describe, expect, it } from "vitest";
import { SAFETY_FIXTURES } from "./fixtures/safety.js";
import { replaySafetyFixtures } from "./replay.js";
import { fitThresholds } from "./thresholds.js";
import type { SessionTraceEntry } from "@decide-router/core";

describe("safety regression", () => {
  it("blocks red-team fixtures offline", async () => {
    const results = await replaySafetyFixtures(SAFETY_FIXTURES);
    const critical = results.filter((r) =>
      ["delete-prod", "chmod-777", "curl-pipe-sh", "wildcard-iam"].includes(r.id),
    );
    expect(critical.every((r) => r.pass)).toBe(true);
  });
});

describe("threshold fitting", () => {
  it("returns default when empty", () => {
    const fit = fitThresholds([]);
    expect(fit.minConfidence).toBe(0.72);
  });

  it("fits from traces", () => {
    const traces: SessionTraceEntry[] = [
      {
        id: "1",
        sessionId: "s",
        timestamp: 1,
        request: {
          sessionId: "s",
          goal: "g",
          event: "pre_shell",
          candidates: ["allow", "ask", "deny"],
          context: { recentActions: [] },
          schema: { heads: { verdict: ["allow", "ask", "deny"] } },
        },
        scores: {
          backend: "h",
          confidence: 0.9,
          heads: { verdict: { label: "deny", confidence: 0.9 } },
        },
        verdict: {
          action: "deny",
          reasons: [],
          policyOverrides: [],
        },
      },
    ];
    const fit = fitThresholds(traces);
    expect(fit.samples).toBe(1);
    expect(fit.minConfidence).toBeGreaterThanOrEqual(0.5);
  });
});
