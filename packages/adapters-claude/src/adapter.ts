import {
  DecideEngine,
  MemorySessionTraceStore,
  normalizeEvent,
  type ActionSummary,
  type Verdict,
} from "@decide-router/core";
import {
  FallbackBackend,
  GlinerDecideBackend,
  HeuristicBackend,
} from "@decide-router/backends";
import {
  DeterministicPolicyEngine,
  DEFAULT_POLICY,
  loadRootConfig,
  policyFromRootConfig,
  mergePolicyOverlay,
} from "@decide-router/policy";
import { TreeRegistry } from "@decide-router/trees";
import { runBootstrap, type BootstrapArtifact } from "@decide-router/bootstrap";
import { existsSync } from "node:fs";
import { join } from "node:path";

const recentBySession = new Map<string, ActionSummary[]>();
let registry = new TreeRegistry();
let bootstrapArtifact: BootstrapArtifact | undefined;

export async function claudeSessionStart(cwd = process.cwd()): Promise<{
  agentInstruction: string;
  trees: string[];
}> {
  const artifact = await runBootstrap({ root: cwd, writeArtifacts: true });
  bootstrapArtifact = artifact;
  registry = new TreeRegistry();
  registry.overlay.load(artifact.trees);
  return {
    agentInstruction: artifact.agentInstruction,
    trees: artifact.trees.map((t) => t.id),
  };
}

function engineFor(cwd: string, goal: string): DecideEngine {
  let policy = existsSync(join(cwd, "decide-router.config.yaml"))
    ? policyFromRootConfig(loadRootConfig(join(cwd, "decide-router.config.yaml")))
    : { ...DEFAULT_POLICY };

  if (bootstrapArtifact?.policyOverlayHints) {
    policy = mergePolicyOverlay(policy, {
      protected_paths: bootstrapArtifact.policyOverlayHints.protected_paths,
      tool_deny: bootstrapArtifact.policyOverlayHints.tool_deny,
      network: {
        default: policy.network.default,
        allow: [
          ...policy.network.allow,
          ...bootstrapArtifact.policyOverlayHints.network_allow,
        ],
      },
    });
  }

  let playbook;
  try {
    const id =
      bootstrapArtifact?.trees[0]?.id ??
      "safe-change";
    playbook = registry.createPlaybook(id);
  } catch {
    playbook = undefined;
  }

  // Do NOT force fail_closed: false on policy — that flag is for invalid-regex
  // handling, separate from process-crash / backend fail-open.
  return new DecideEngine({
    backend: new FallbackBackend(
      new GlinerDecideBackend(),
      new HeuristicBackend(),
    ),
    policy: new DeterministicPolicyEngine(policy),
    store: new MemorySessionTraceStore(),
    playbook,
    // Backend crash → allow. Policy denials still apply when evaluated.
    config: { failClosed: false },
  });
}

/** Map Claude PreToolUse / Bash to the same core path as Cursor. Fail open. */
export async function claudePreToolUse(input: {
  sessionId?: string;
  toolName: string;
  args?: unknown;
  command?: string;
  goal?: string;
  cwd?: string;
}): Promise<{ permission: "allow" | "deny" | "ask"; verdict: Verdict }> {
  try {
    const cwd = input.cwd ?? process.cwd();
    const sessionId = input.sessionId ?? "claude-session";
    const isShell =
      /bash|shell|terminal/i.test(input.toolName) || !!input.command;

    const engine = engineFor(cwd, input.goal ?? "Complete the task safely");
    const req = normalizeEvent({
      harness: "claude",
      hook: isShell ? "beforeShellExecution" : "preToolUse",
      sessionId,
      goal: input.goal ?? "Complete the task safely",
      toolName: input.toolName,
      command: input.command,
      args: input.args,
      recentActions: recentBySession.get(sessionId) ?? [],
    });

    const verdict = await engine.decide(req);
    const permission =
      verdict.action === "deny"
        ? "deny"
        : verdict.action === "ask"
          ? "ask"
          : "allow";
    return { permission, verdict };
  } catch {
    return {
      permission: "allow",
      verdict: {
        action: "allow",
        reasons: ["fail_open"],
        policyOverrides: [],
      },
    };
  }
}

export async function claudePostToolUse(input: {
  sessionId?: string;
  toolName: string;
  args?: unknown;
  goal?: string;
  cwd?: string;
}): Promise<{ continue: boolean; verdict: Verdict }> {
  const sessionId = input.sessionId ?? "claude-session";
  const recent = recentBySession.get(sessionId) ?? [];
  recent.push({
    toolName: input.toolName,
    argsPreview: JSON.stringify(input.args ?? {}).slice(0, 200),
    outcome: "ok",
    timestamp: Date.now(),
  });
  recentBySession.set(sessionId, recent.slice(-50));

  const engine = engineFor(input.cwd ?? process.cwd(), input.goal ?? "Complete the task safely");
  const verdict = await engine.decide(
    normalizeEvent({
      harness: "claude",
      hook: "postToolUse",
      sessionId,
      goal: input.goal ?? "Complete the task safely",
      toolName: input.toolName,
      args: input.args,
      recentActions: recent,
    }),
  );

  return { continue: verdict.action !== "deny", verdict };
}

export async function claudeStop(input: {
  sessionId?: string;
  goal?: string;
  cwd?: string;
}): Promise<{ block: boolean; verdict: Verdict }> {
  const sessionId = input.sessionId ?? "claude-session";
  const engine = engineFor(input.cwd ?? process.cwd(), input.goal ?? "Complete the task safely");
  const verdict = await engine.decide(
    normalizeEvent({
      harness: "claude",
      hook: "stop",
      sessionId,
      goal: input.goal ?? "Complete the task safely",
      recentActions: recentBySession.get(sessionId) ?? [],
    }),
  );
  return { block: verdict.action === "deny", verdict };
}
