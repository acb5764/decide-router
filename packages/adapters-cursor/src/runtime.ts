import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
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
  DEFAULT_POLICY,
} from "@decide-router/policy";
import { TreeRegistry } from "@decide-router/trees";
import { runBootstrap, type BootstrapArtifact } from "@decide-router/bootstrap";
import type { AuthHookResult, HookPermission } from "./hook-protocol.js";

export interface CursorAdapterConfig {
  goal: string;
  playbooks?: string[];
  bootstrap?: { onSessionStart?: boolean; minConfidence?: number };
  root?: string;
  auditPath?: string;
  /** Hook path fails open on engine/backend errors (default true). */
  failOpen?: boolean;
}

const recentBySession = new Map<string, ActionSummary[]>();
let cachedBootstrap: BootstrapArtifact | undefined;
let registry = new TreeRegistry();

export function dataDir(): string {
  return (
    process.env.DECIDE_ROUTER_DATA_DIR ??
    join(homedir(), ".cursor", "decide-router")
  );
}

export function loadCursorConfig(cwd = process.cwd()): CursorAdapterConfig {
  const candidates = [
    join(cwd, "decide-router.config.yaml"),
    join(cwd, "decide-router.config.yml"),
    join(cwd, ".cursor", "decide-router.yaml"),
    join(dataDir(), "decide-router.config.yaml"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const root = loadRootConfig(p);
      const sample = parseYaml(readFileSync(p, "utf8")) as Record<
        string,
        unknown
      >;
      const policy = sample.policy as { fail_closed?: boolean } | undefined;
      return {
        goal: (root.goal as string) ?? "Complete the user task safely",
        playbooks: root.playbooks,
        bootstrap: sample.bootstrap as CursorAdapterConfig["bootstrap"],
        root: cwd,
        auditPath:
          ((sample.audit as { path?: string } | undefined)?.path) ??
          join(dataDir(), "audit.jsonl"),
        // Hooks fail open unless config explicitly fail_closed: true
        failOpen: policy?.fail_closed !== true,
      };
    } catch {
      continue;
    }
  }
  return {
    goal: "Complete the user task safely",
    playbooks: ["safe-change"],
    bootstrap: { onSessionStart: true },
    root: cwd,
    auditPath: join(dataDir(), "audit.jsonl"),
    failOpen: true,
  };
}

export function createEngine(cfg: CursorAdapterConfig): DecideEngine {
  const rootPath = cfg.root ?? process.cwd();
  let policyConfig = existsSync(join(rootPath, "decide-router.config.yaml"))
    ? policyFromRootConfig(
        loadRootConfig(join(rootPath, "decide-router.config.yaml")),
      )
    : { ...DEFAULT_POLICY, fail_closed: false };

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

  // Hook adapters fail open: engine errors → allow (policy still denies when it runs)
  policyConfig = { ...policyConfig, fail_closed: false };

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
    config: { failClosed: false },
  });
}

export async function runBootstrapForSession(
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

/** @deprecated use runBootstrapForSession */
export const sessionStartBootstrap = runBootstrapForSession;

export async function authorizeHook(input: {
  hook: RawHarnessEvent["hook"];
  sessionId?: string;
  toolName?: string;
  command?: string;
  args?: unknown;
  contextChunks?: RawHarnessEvent["contextChunks"];
  cwd?: string;
}): Promise<AuthHookResult & { verdict?: Verdict }> {
  const cwd = input.cwd ?? process.cwd();
  const cfg = loadCursorConfig(cwd);
  const sessionId = input.sessionId ?? "cursor-session";
  const recent = recentBySession.get(sessionId) ?? [];

  try {
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
    } else if (
      input.hook === "beforeShellExecution" ||
      input.hook === "beforeMCPExecution" ||
      input.hook === "preToolUse"
    ) {
      // Track attempted actions for loop detection even before post
      recent.push({
        toolName: input.toolName ?? (input.command ? "Shell" : "unknown"),
        argsPreview: (input.command ?? JSON.stringify(input.args ?? "")).slice(
          0,
          200,
        ),
        outcome: verdict.action === "deny" ? "denied" : "unknown",
        timestamp: Date.now(),
      });
      recentBySession.set(sessionId, recent.slice(-50));
    }

    audit(cfg, { hook: input.hook, sessionId, verdict });

    const permission = verdictToPermission(verdict);
    const message =
      verdict.hint ??
      (verdict.reasons.length ? verdict.reasons.join("; ") : undefined);

    return {
      permission,
      user_message: message,
      agent_message: message,
      reasons: verdict.reasons,
      verdict,
    };
  } catch (err) {
    // Fail open — never block the agent because Decide-Router crashed
    audit(cfg, {
      hook: input.hook,
      sessionId,
      failOpen: true,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      permission: "allow",
      agent_message:
        "Decide-Router error — fail open (allow). Do not spend tokens compensating.",
      reasons: ["fail_open"],
    };
  }
}

/** @deprecated use authorizeHook */
export async function handleHook(
  input: Parameters<typeof authorizeHook>[0],
): Promise<{
  permission: HookPermission;
  verdict: Verdict;
  agentInstruction?: string;
}> {
  const r = await authorizeHook(input);
  return {
    permission: r.permission,
    verdict: r.verdict ?? {
      action: r.permission === "deny" ? "deny" : "allow",
      reasons: r.reasons ?? ["fail_open"],
      policyOverrides: [],
    },
    agentInstruction: r.agent_message,
  };
}

function verdictToPermission(verdict: Verdict): HookPermission {
  if (verdict.action === "deny") return "deny";
  if (verdict.action === "ask") return "ask";
  return "allow";
}

function audit(cfg: CursorAdapterConfig, payload: unknown): void {
  const path = resolve(
    cfg.auditPath?.startsWith("/") || cfg.auditPath?.startsWith("~")
      ? cfg.auditPath.replace(/^~/, homedir())
      : join(cfg.root ?? process.cwd(), cfg.auditPath ?? join(dataDir(), "audit.jsonl")),
  );
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      JSON.stringify({ ts: Date.now(), ...((payload as object) ?? {}) }) + "\n",
    );
  } catch {
    /* best-effort */
  }
}

export type { DecisionEvent, Verdict };
