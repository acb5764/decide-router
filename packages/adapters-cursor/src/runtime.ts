import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import {
  DecideEngine,
  MemorySessionTraceStore,
  normalizeEvent,
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
import {
  ingestContextFiles,
  runBootstrap,
  type BootstrapArtifact,
} from "@decide-router/bootstrap";
import type { AuthHookResult, HookPermission } from "./hook-protocol.js";
import {
  appendAuditLine,
  loadRecentActionsFromAudit,
  resolveAuditPath,
} from "./audit-log.js";

export interface CursorAdapterConfig {
  goal: string;
  playbooks?: string[];
  bootstrap?: { onSessionStart?: boolean; minConfidence?: number };
  root?: string;
  auditPath?: string;
}

let cachedBootstrap: BootstrapArtifact | undefined;
let registry = new TreeRegistry();

export function dataDir(): string {
  return (
    process.env.DECIDE_ROUTER_DATA_DIR ??
    join(homedir(), ".cursor", "decide-router")
  );
}

export function handlersDistReady(root = dataDir()): boolean {
  return (
    existsSync(join(root, "dist", "handlers", "before-shell.js")) ||
    existsSync(join(root, "dist", "handlers", "session-start.js"))
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
      return {
        goal: (root.goal as string) ?? "Complete the user task safely",
        playbooks: root.playbooks,
        bootstrap: sample.bootstrap as CursorAdapterConfig["bootstrap"],
        root: cwd,
        auditPath:
          ((sample.audit as { path?: string } | undefined)?.path) ??
          join(dataDir(), "audit.jsonl"),
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
  };
}

export function auditPathFor(cfg: CursorAdapterConfig): string {
  return resolveAuditPath(
    cfg.auditPath ?? join(dataDir(), "audit.jsonl"),
    cfg.root ?? process.cwd(),
  );
}

export function createEngine(cfg: CursorAdapterConfig): DecideEngine {
  const rootPath = cfg.root ?? process.cwd();
  let policyConfig = existsSync(join(rootPath, "decide-router.config.yaml"))
    ? policyFromRootConfig(
        loadRootConfig(join(rootPath, "decide-router.config.yaml")),
      )
    : { ...DEFAULT_POLICY };

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

  // Do NOT force fail_closed: false — that flag is for invalid-regex handling,
  // separate from process-crash fail-open.

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
    // Backend crash → allow (fail open). Policy denials still apply when evaluated.
    config: { failClosed: false },
  });
}

/** Fingerprint preference sources; rewrite bootstrap only when this changes. */
export function bootstrapSourceFingerprint(cwd: string): string {
  const files = ingestContextFiles(cwd);
  const h = createHash("sha256");
  for (const f of files.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  )) {
    h.update(f.relativePath);
    h.update("\0");
    try {
      h.update(String(statSync(f.path).mtimeMs));
      h.update("\0");
      h.update(f.content);
    } catch {
      h.update("missing");
    }
    h.update("\n");
  }
  return h.digest("hex");
}

export async function runBootstrapForSession(
  cwd = process.cwd(),
): Promise<BootstrapArtifact | undefined> {
  const cfg = loadCursorConfig(cwd);
  if (cfg.bootstrap?.onSessionStart === false) return undefined;

  const fp = bootstrapSourceFingerprint(cwd);
  const bootDir = join(cwd, ".decide-router", "bootstrap");
  const fpPath = join(bootDir, "fingerprint.json");
  const artifactPath = join(bootDir, "artifact.json");

  let previous: string | undefined;
  try {
    previous = (
      JSON.parse(readFileSync(fpPath, "utf8")) as { fingerprint?: string }
    ).fingerprint;
  } catch {
    previous = undefined;
  }

  if (previous === fp && existsSync(artifactPath)) {
    try {
      const artifact = JSON.parse(
        readFileSync(artifactPath, "utf8"),
      ) as BootstrapArtifact;
      cachedBootstrap = artifact;
      registry = new TreeRegistry();
      registry.overlay.load(artifact.trees);
      return artifact;
    } catch {
      /* fall through to rewrite */
    }
  }

  const artifact = await runBootstrap({
    root: cwd,
    writeArtifacts: true,
    minConfidence: cfg.bootstrap?.minConfidence ?? 0.72,
  });
  cachedBootstrap = artifact;
  registry = new TreeRegistry();
  registry.overlay.load(artifact.trees);
  try {
    mkdirSync(bootDir, { recursive: true });
    writeFileSync(
      fpPath,
      JSON.stringify({ fingerprint: fp, at: new Date().toISOString() }, null, 2) +
        "\n",
    );
  } catch {
    /* best-effort */
  }
  appendAuditLine(auditPathFor(cfg), {
    type: "bootstrap",
    sessionId: "bootstrap",
    trees: artifact.trees.map((t) => t.id),
    rules: artifact.rules.length,
    fingerprint: fp,
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
  const path = auditPathFor(cfg);

  // Cross-process session memory: reload from audit.jsonl every hook
  const recent = loadRecentActionsFromAudit(path, sessionId, 50);

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

    const toolName =
      input.toolName ?? (input.command ? "Shell" : undefined) ?? "unknown";
    const argsPreview = (
      input.command ??
      (typeof input.args === "string"
        ? input.args
        : JSON.stringify(input.args ?? {}))
    ).slice(0, 200);
    const outcome =
      verdict.action === "deny"
        ? "denied"
        : input.hook === "postToolUse"
          ? "ok"
          : "unknown";

    if (
      input.hook === "postToolUse" ||
      input.hook === "beforeShellExecution" ||
      input.hook === "beforeMCPExecution" ||
      input.hook === "preToolUse"
    ) {
      appendAuditLine(path, {
        type: "action",
        sessionId,
        hook: input.hook,
        toolName,
        argsPreview,
        outcome,
        verdict: { action: verdict.action, reasons: verdict.reasons },
      });
    } else {
      appendAuditLine(path, {
        type: "hook",
        sessionId,
        hook: input.hook,
        verdict: { action: verdict.action, reasons: verdict.reasons },
      });
    }

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
    // Fail open — handler crashed; policy did not evaluate
    appendAuditLine(path, {
      type: "fail_open",
      sessionId,
      hook: input.hook,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      permission: "allow",
      agent_message:
        "Decide-Router error — fail open (allow). Handlers crashed; do not spend tokens compensating.",
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

export type { DecisionEvent, Verdict };
