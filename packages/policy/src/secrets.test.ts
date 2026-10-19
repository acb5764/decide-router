import { describe, expect, it } from "vitest";
import { containsLikelySecret, scanSecrets } from "./secrets.js";
import { DeterministicPolicyEngine } from "./engine.js";
import { DEFAULT_POLICY } from "./types.js";
import { ACTION_GATE_SCHEMA, type DecisionScores } from "@decide-router/core";

const safeScores: DecisionScores = {
  backend: "t",
  confidence: 0.9,
  heads: {
    goal_relevance: { label: "on_goal", confidence: 0.9 },
    risk: { label: "safe", confidence: 0.9 },
    verdict: { label: "allow", confidence: 0.9 },
  },
};

describe("secret heuristics", () => {
  it("flags known provider prefixes", () => {
    expect(
      containsLikelySecret('token = "ghp_abcdefghijklmnopqrstuvwxyz0123"'),
    ).toBe(true);
  });

  it("flags high-entropy assignment secrets", () => {
    const hits = scanSecrets('api_key: "SuperSecret123!@#xy"');
    expect(hits.some((h) => h.kind === "assignment")).toBe(true);
  });

  it("ignores placeholders and uuids", () => {
    expect(containsLikelySecret('password: "changeme"')).toBe(false);
    expect(
      containsLikelySecret("id=550e8400-e29b-41d4-a716-446655440000"),
    ).toBe(false);
  });

  it("policy denies secret content fail-closed", () => {
    const engine = new DeterministicPolicyEngine(DEFAULT_POLICY);
    const v = engine.evaluate(
      {
        sessionId: "s",
        goal: "debug",
        event: "pre_tool",
        candidates: ["allow", "ask", "deny"],
        context: {
          recentActions: [],
          toolName: "Write",
          argsPreview: 'OPENAI_API_KEY=sk-live-abcdefghijklmnopqrstuvwxyz012345',
        },
        schema: ACTION_GATE_SCHEMA,
      },
      safeScores,
    );
    expect(v.action).toBe("deny");
    expect(v.policyOverrides.some((p) => p.startsWith("secret_content"))).toBe(
      true,
    );
  });
});
