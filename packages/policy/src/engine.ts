import { minimatch } from "minimatch";
import type {
  DecisionRequest,
  DecisionScores,
  PolicyEngine,
  Verdict,
} from "@decide-router/core";
import { DEFAULT_POLICY, type PolicyConfig } from "./types.js";

export class DeterministicPolicyEngine implements PolicyEngine {
  constructor(private readonly config: PolicyConfig = DEFAULT_POLICY) {}

  evaluate(request: DecisionRequest, scores: DecisionScores): Verdict {
    const overrides: string[] = [];
    const reasons: string[] = [];
    const text = [
      request.context.toolName ?? "",
      request.context.argsPreview ?? "",
    ]
      .join(" ")
      .trim();

    // Protected paths — fail closed
    for (const glob of this.config.protected_paths) {
      if (pathHit(text, glob) || pathHit(request.context.argsPreview ?? "", glob)) {
        overrides.push(`protected_path:${glob}`);
        reasons.push(`Blocked protected path matching ${glob}`);
        return deny(scores, reasons, overrides);
      }
    }

    // Dangerous shell patterns
    if (request.event === "pre_shell" || looksLikeShell(request)) {
      for (const pattern of this.config.dangerous_shell_patterns) {
        try {
          const re = new RegExp(pattern, "i");
          if (re.test(text)) {
            overrides.push(`dangerous_shell:${pattern}`);
            reasons.push(`Dangerous shell pattern matched: ${pattern}`);
            return deny(scores, reasons, overrides);
          }
        } catch {
          if (this.config.fail_closed) {
            overrides.push(`invalid_pattern_fail_closed:${pattern}`);
            return deny(scores, ["Invalid dangerous pattern; fail closed"], overrides);
          }
        }
      }
    }

    // Network allow/deny
    const host = extractHost(text);
    if (host) {
      const denied = this.config.network.deny ?? [];
      if (denied.some((d) => hostMatches(host, d))) {
        overrides.push(`network_deny:${host}`);
        return deny(scores, [`Network host denied: ${host}`], overrides);
      }
      const allowed = this.config.network.allow.some((a) => hostMatches(host, a));
      if (this.config.network.default === "deny" && !allowed) {
        // Lateral / scan heuristics
        if (looksLateral(text)) {
          overrides.push(`network_lateral:${host}`);
          return deny(scores, [`Lateral network pattern blocked: ${host}`], overrides);
        }
        overrides.push(`network_default_deny:${host}`);
        return deny(scores, [`Network host not allowlisted: ${host}`], overrides);
      }
    }

    // Permission shape checks
    for (const shape of this.config.permission_deny_shapes) {
      if (permissionHit(text, shape)) {
        overrides.push(`permission_shape:${shape}`);
        return deny(
          scores,
          [`Permission shape denied: ${shape}`],
          overrides,
        );
      }
    }

    // Tool allow/deny lists
    const tool = request.context.toolName;
    if (tool && this.config.tool_deny?.includes(tool)) {
      overrides.push(`tool_deny:${tool}`);
      return deny(scores, [`Tool denied by policy: ${tool}`], overrides);
    }
    if (
      tool &&
      this.config.tool_allow &&
      this.config.tool_allow.length > 0 &&
      !this.config.tool_allow.includes(tool)
    ) {
      overrides.push(`tool_not_allowlisted:${tool}`);
      return deny(scores, [`Tool not on allowlist: ${tool}`], overrides);
    }

    // Model-suggested verdict — policy may still escalate destructive
    const modelVerdict = scores.heads.verdict?.label;
    const risk = scores.heads.risk?.label;
    if (
      risk === "destructive" ||
      risk === "privilege_escalation" ||
      risk === "network_lateral"
    ) {
      if (modelVerdict === "allow") {
        overrides.push("policy_escalates_destructive");
        return {
          action: "ask",
          scores,
          reasons: ["Destructive risk requires human ask; model cannot sole-authorize"],
          policyOverrides: overrides,
        };
      }
    }

    if (modelVerdict === "deny") {
      return deny(scores, ["Model verdict deny"], overrides);
    }
    if (modelVerdict === "ask") {
      return {
        action: "ask",
        scores,
        reasons: ["Model verdict ask"],
        policyOverrides: overrides,
      };
    }

    return {
      action: "allow",
      scores,
      reasons: reasons.length ? reasons : ["policy_clear"],
      policyOverrides: overrides,
    };
  }
}

function deny(
  scores: DecisionScores,
  reasons: string[],
  policyOverrides: string[],
): Verdict {
  return { action: "deny", scores, reasons, policyOverrides };
}

function pathHit(haystack: string, glob: string): boolean {
  if (!haystack) return false;
  // Extract path-like tokens
  const tokens = haystack.split(/[\s"'=,{}[\]]+/).filter(Boolean);
  for (const t of tokens) {
    if (minimatch(t, glob, { dot: true, nocase: true })) return true;
    // Also try as substring path
    if (t.includes("/") && minimatch(t.replace(/^\.\//, ""), glob, { dot: true })) {
      return true;
    }
  }
  return minimatch(haystack, glob, { dot: true });
}

function looksLikeShell(req: DecisionRequest): boolean {
  return (
    req.context.toolName === "shell" ||
    req.context.toolName === "Shell" ||
    req.context.toolName === "Bash"
  );
}

function extractHost(text: string): string | undefined {
  const m =
    text.match(/https?:\/\/([^/\s:]+)/i) ||
    text.match(/\b(?:curl|wget|fetch)\s+[^\s]*\s+([a-z0-9.-]+\.[a-z]{2,})/i) ||
    text.match(/\b([a-z0-9.-]+\.[a-z]{2,})\b/i);
  return m?.[1]?.toLowerCase();
}

function hostMatches(host: string, rule: string): boolean {
  const r = rule.toLowerCase();
  if (r.startsWith("*.")) return host === r.slice(2) || host.endsWith(r.slice(1));
  return host === r;
}

function looksLateral(text: string): boolean {
  return /nmap|masscan|port\s*scan|ssrf|169\.254\.169\.254|internal\./i.test(
    text,
  );
}

function permissionHit(text: string, shape: string): boolean {
  if (shape === "*") {
    return /["']?\*["']?\s*[,}]|"Action"\s*:\s*"\*"|permissions?\s*[:=]\s*\*|IAM.*\*/i.test(
      text,
    );
  }
  if (shape === "*:*") {
    return /\*:\*|Resource["']?\s*:\s*["']?\*/i.test(text);
  }
  return text.includes(shape);
}

export function mergePolicyOverlay(
  base: PolicyConfig,
  overlay: Partial<PolicyConfig>,
): PolicyConfig {
  return {
    ...base,
    ...overlay,
    protected_paths: [
      ...base.protected_paths,
      ...(overlay.protected_paths ?? []),
    ],
    dangerous_shell_patterns: [
      ...base.dangerous_shell_patterns,
      ...(overlay.dangerous_shell_patterns ?? []),
    ],
    permission_deny_shapes: [
      ...base.permission_deny_shapes,
      ...(overlay.permission_deny_shapes ?? []),
    ],
    network: {
      ...base.network,
      ...overlay.network,
      allow: [
        ...base.network.allow,
        ...(overlay.network?.allow ?? []),
      ],
      deny: [
        ...(base.network.deny ?? []),
        ...(overlay.network?.deny ?? []),
      ],
    },
    tool_allow: overlay.tool_allow ?? base.tool_allow,
    tool_deny: [
      ...(base.tool_deny ?? []),
      ...(overlay.tool_deny ?? []),
    ],
  };
}
