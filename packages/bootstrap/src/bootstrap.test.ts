import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HeuristicBackend } from "@decide-router/backends";
import { DeterministicPolicyEngine, DEFAULT_POLICY } from "@decide-router/policy";
import { DecideEngine, normalizeEvent } from "@decide-router/core";
import { TreeRegistry } from "@decide-router/trees";
import { ingestContextFiles } from "./sources.js";
import { normalizeRuleCandidates, extractRules } from "./extract.js";
import { runBootstrap } from "./run.js";

describe("bootstrap", () => {
  it("ingests known files and extracts closed labels offline", async () => {
    const root = join(tmpdir(), `dr-bootstrap-${Date.now()}`);
    mkdirSync(join(root, ".cursor", "rules"), { recursive: true });
    writeFileSync(
      join(root, "AGENTS.md"),
      "# Agents\n\n- Never deploy to production\n- Prefer TypeScript\n- Ask before chmod\n",
    );
    writeFileSync(
      join(root, ".cursor", "rules", "safety.md"),
      "- Protect **/.env* secrets\n- Allow host api.github.com\n",
    );
    writeFileSync(
      join(root, "decide-router.config.yaml"),
      "policy:\n  fail_closed: true\n  protected_paths:\n    - \"**/prod/**\"\n",
    );

    try {
      const files = ingestContextFiles(root);
      expect(files.length).toBeGreaterThanOrEqual(2);

      const raw = normalizeRuleCandidates(files);
      expect(raw.length).toBeGreaterThan(0);

      const rules = await extractRules(files, new HeuristicBackend());
      expect(rules.every((r) => r.label)).toBe(true);
      expect(rules.some((r) => r.label === "hard_block" || r.label === "path_protect" || r.label === "prefer")).toBe(
        true,
      );

      const artifact = await runBootstrap({
        root,
        backend: new HeuristicBackend(),
        writeArtifacts: true,
        minConfidence: 0.5,
      });
      expect(artifact.agentInstruction).toContain("judgment ≠ permission");
      expect(artifact.trees.length).toBeGreaterThanOrEqual(1);

      // Bootstrapped trees still pass through deterministic policy
      const registry = new TreeRegistry();
      registry.overlay.load(artifact.trees);
      const playbook = registry.createPlaybook(artifact.trees[0]!.id);
      const engine = new DecideEngine({
        backend: new HeuristicBackend(),
        policy: new DeterministicPolicyEngine(DEFAULT_POLICY),
        playbook,
      });
      const verdict = await engine.decide(
        normalizeEvent({
          harness: "test",
          hook: "beforeShellExecution",
          sessionId: "boot",
          goal: "test",
          command: "rm -rf ./prod/db",
        }),
      );
      expect(verdict.action).toBe("deny");
      expect(verdict.policyOverrides.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
