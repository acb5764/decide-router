import { describe, expect, it } from "vitest";
import { extractHost, DeterministicPolicyEngine } from "./engine.js";
import { DEFAULT_POLICY, SAMPLE_NETWORK_DENY_POLICY } from "./types.js";
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

describe("extractHost", () => {
  it("parses real https URLs", () => {
    expect(extractHost("curl https://api.github.com/repos")).toBe(
      "api.github.com",
    );
  });

  it("does not treat filenames as hosts", () => {
    expect(extractHost("cat README.md")).toBeUndefined();
    expect(extractHost("open hooks.json")).toBeUndefined();
    expect(extractHost("edit foo.ts")).toBeUndefined();
    expect(extractHost("ls packages/policy/src/engine.ts")).toBeUndefined();
  });

  it("parses curl host without scheme when not a filename", () => {
    expect(extractHost("curl example.com/path")).toBe("example.com");
  });
});

describe("default network policy", () => {
  it("defaults to allow", () => {
    expect(DEFAULT_POLICY.network.default).toBe("allow");
  });

  it("allows cat README.md under default policy", () => {
    const engine = new DeterministicPolicyEngine(DEFAULT_POLICY);
    const v = engine.evaluate(
      {
        sessionId: "s",
        goal: "read docs",
        event: "pre_shell",
        candidates: ["allow", "ask", "deny"],
        context: {
          recentActions: [],
          toolName: "Shell",
          argsPreview: "cat README.md",
        },
        schema: ACTION_GATE_SCHEMA,
      },
      safeScores,
    );
    expect(v.action).toBe("allow");
  });

  it("sample deny policy blocks non-allowlisted https hosts", () => {
    const engine = new DeterministicPolicyEngine({
      ...DEFAULT_POLICY,
      network: SAMPLE_NETWORK_DENY_POLICY,
    });
    const v = engine.evaluate(
      {
        sessionId: "s",
        goal: "fetch",
        event: "pre_shell",
        candidates: ["allow", "ask", "deny"],
        context: {
          recentActions: [],
          toolName: "Shell",
          argsPreview: "curl https://evil.example/x",
        },
        schema: ACTION_GATE_SCHEMA,
      },
      safeScores,
    );
    expect(v.action).toBe("deny");
    expect(v.policyOverrides.some((p) => p.startsWith("network_"))).toBe(true);
  });
});
