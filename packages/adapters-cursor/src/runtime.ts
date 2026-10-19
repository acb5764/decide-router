import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  DecideEngine,
  MemorySessionTraceStore,
  normalizeEvent,
  type ActionSummary,
  type DecisionEvent,
  type RawHarnessEvent,
  type Verdict,
} from "@decide-router/core";
import {
  FallbackBackend,
  GlinerDecideBackend,
  HeuristicBackend,
} from "@decide-router/backends";
import {
  DeterministicPolicyEngine,
  loadRootConfig,
  policyFromRootConfig,
  mergePolicyOverlay,
} from "@decide-router/policy";
import { TreeRegistry } from "@decide-router/trees";
import { runBootstrap, type BootstrapArtifact } from "@decide-router/bootstrap";

export interface CursorAdapterConfig {
  goal: string;
  playbooks?: string[];
  bootstrap?: { onSessionStart?: boolean; minConfidence?: number };
  root?: string;
  auditPath?: string;
}

const recentBySession = new Map<string, ActionSummary[]>();
let cachedBootstrap: BootstrapArtifact | undefined;
let registry = new TreeRegistry();

export function loadCursorConfig(cwd = process.cwd()): CursorAdapterConfig {
  const candidates = [
    join(cwd, "decide-router.config.yaml"),
    join(cwd, "decide-router.config.yml"),
    join(cwd, ".cursor", "decide-router.yaml"),
    join(cwd, "packages", "adapters-cursor", "sample-config.yaml"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    if (p.endsWith(".yaml") || p.endsWith(".yml")) {
      try {
        const root = loadRootConfig(p);
        const sample = parseYaml(readFileSync(p, "utf8")) as Record<string, unknown>;
        return {
          goal: (root.goal as string) ?? "Complete the user task safely",
          playbooks: root.playbooks,
          bootstrap: sample.bootstrap as CursorAdapterConfig["bootstrap"],
          root: cwd,
          auditPath:
            ((sample.audit as { path?: string } | undefined)?.path) ??
            ".decide-router/audit.jsonl",
        };
      } catch {
        continue;
      }
    }
  }
  return {
    goal: "Complete the user task safely",
    playbooks: ["safe-change"],
    bootstrap: { onSessionStart: true },
    root: cwd,
    auditPath: ".decide-router/audit.jsonl",
  };
}

export function createEngine(cfg: CursorAdapterConfig): DecideEngine {
  const rootPath = cfg.root ?? process.cwd();
  let policyConfig = policyFromRootConfig(
    existsSync(join(rootPath, "decide-router.config.yaml"))
      ? loadRootConfig(join(rootPath, "decide-router.config.yaml"))
      : {},
  );

  if (cachedBootstrap?.policyOverlayHints) {
    policyConfig = mergePolicyOverlay(policyConfig, {
      protected_paths: cachedBootstrap.policyOverlayHints.protected_paths,
      tool_deny: cachedBootstrap.policyOverlayHints.tool_deny,
      network: {
        default: policyConfig.network.default,
        allow: [
          ...policyConfig.network.allow,
          ...cachedBootstrap.policyOverlayHints.network_allow,
        ],
      },
    });
  }

  const playbookId =
    cfg.playbooks?.find((id) => registry.get(id)) ??
    cfg.playbooks?.[0] ??
    "safe-change";
  let playbook;
  try {
    playbook = registry.createPlaybook(playbookId);
  } catch {
    playbook = undefined;
  }

  return new DecideEngine({
    backend: new FallbackBackend(
      new GlinerDecideBackend(),
      new HeuristicBackend(),
    ),
    policy: new DeterministicPolicyEngine(policyConfig),
    store: new MemorySessionTraceStore(),
    playbook,
    config: { failClosed: true },
  });
}

export async function sessionStartBootstrap(
  cwd = process.cwd(),
): Promise<BootstrapArtifact | undefined> {
  const cfg = loadCursorConfig(cwd);
  if (cfg.bootstrap?.onSessionStart === false) return undefined;
  const artifact = await runBootstrap({
    root: cwd,
    writeArtifacts: true,
    minConfidence: cfg.bootstrap?.minConfidence ?? 0.72,
  });
  cachedBootstrap = artifact;
  registry = new TreeRegistry();
  registry.overlay.load(artifact.trees);
  audit(cfg, {
    type: "bootstrap",
    trees: artifact.trees.map((t) => t.id),
    rules: artifact.rules.length,
  });
  return artifact;
}

export async function handleHook(input: {
  hook: RawHarnessEvent["hook"];
  sessionId?: string;
  toolName?: string;
  command?: string;
  args?: unknown;
  contextChunks?: RawHarnessEvent["contextChunks"];
  cwd?: string;
}): Promise<{ permission: "allow" | "deny" | "ask"; verdict: Verdict; agentInstruction?: string }> {
  const cwd = input.cwd ?? process.cwd();
  const cfg = loadCursorConfig(cwd);
  const sessionId = input.sessionId ?? "cursor-session";
  const recent = recentBySession.get(sessionId) ?? [];

  const engine = createEngine(cfg);
  const raw: RawHarnessEvent = {
    harness: "cursor",
    hook: input.hook,
    sessionId,
    goal: cfg.goal,
    toolName: input.toolName,
    command: input.command,
    args: input.args,
    recentActions: recent,
    contextChunks: input.contextChunks,
  };

  const req = normalizeEvent(raw);
  const verdict = await engine.decide(req);

  if (input.hook === "postToolUse") {
    recent.push({
      toolName: input.toolName ?? "unknown",
      argsPreview:
        typeof input.args === "string"
          ? input.args.slice(0, 200)
          : JSON.stringify(input.args ?? {}).slice(0, 200),
      outcome: verdict.action === "deny" ? "denied" : "ok",
      timestamp: Date.now(),
    });
    recentBySession.set(sessionId, recent.slice(-50));
  }

  audit(cfg, { hook: input.hook, sessionId, verdict });

  const permission =
    verdict.action === "deny"
      ? "deny"
      : verdict.action === "ask"
        ? "ask"
        : "allow";

  return { permission, verdict };
}

function audit(cfg: CursorAdapterConfig, payload: unknown): void {
  const path = resolve(cfg.root ?? process.cwd(), cfg.auditPath ?? ".decide-router/audit.jsonl");
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: Date.now(), ...((payload as object) ?? {}) }) + "\n");
  } catch {
    /* best-effort */
  }
}

export type { DecisionEvent, Verdict };
