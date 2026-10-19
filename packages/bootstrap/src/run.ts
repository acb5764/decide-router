import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DecisionBackend } from "@decide-router/core";
import { HeuristicBackend, GlinerDecideBackend, FallbackBackend } from "@decide-router/backends";
import {
  materializeBootstrappedTrees,
  TreeRegistry,
  type DecisionTree,
} from "@decide-router/trees";
import { ingestContextFiles } from "./sources.js";
import { extractRules } from "./extract.js";
import {
  buildAgentInstruction,
  policyHintsFromRules,
  type BootstrapArtifact,
} from "./artifact.js";

export interface BootstrapOptions {
  root: string;
  backend?: DecisionBackend;
  minConfidence?: number;
  /** Write artifacts under root/.decide-router/bootstrap/ */
  writeArtifacts?: boolean;
  registry?: TreeRegistry;
}

export async function runBootstrap(
  opts: BootstrapOptions,
): Promise<BootstrapArtifact> {
  const backend =
    opts.backend ??
    new FallbackBackend(new GlinerDecideBackend(), new HeuristicBackend());

  const files = ingestContextFiles(opts.root);
  const rules = await extractRules(files, backend);
  const trees = materializeBootstrappedTrees(rules, {
    minConfidence: opts.minConfidence ?? 0.72,
  });

  const registry = opts.registry ?? new TreeRegistry();
  registry.overlay.load(trees);

  const artifact: BootstrapArtifact = {
    generatedAt: new Date().toISOString(),
    root: opts.root,
    rules,
    trees,
    agentInstruction: buildAgentInstruction(
      opts.root,
      trees.map((t) => t.id),
      rules.length,
    ),
    policyOverlayHints: policyHintsFromRules(
      rules.filter((r) => r.confidence >= (opts.minConfidence ?? 0.72)),
    ),
  };

  if (opts.writeArtifacts) {
    writeBootstrapArtifacts(opts.root, artifact);
  }

  return artifact;
}

export function writeBootstrapArtifacts(
  root: string,
  artifact: BootstrapArtifact,
): string {
  const dir = join(root, ".decide-router", "bootstrap");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "artifact.json"), JSON.stringify(artifact, null, 2));
  writeFileSync(join(dir, "AGENT_BOOTSTRAP.md"), artifact.agentInstruction);
  writeFileSync(
    join(dir, "trees.json"),
    JSON.stringify(artifact.trees satisfies DecisionTree[], null, 2),
  );
  writeFileSync(
    join(dir, "policy-hints.json"),
    JSON.stringify(artifact.policyOverlayHints, null, 2),
  );
  return dir;
}
