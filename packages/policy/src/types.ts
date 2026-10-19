export interface NetworkPolicy {
  default: "allow" | "deny";
  allow: string[];
  deny?: string[];
}

export interface PolicyConfig {
  protected_paths: string[];
  dangerous_shell_patterns: string[];
  network: NetworkPolicy;
  permission_deny_shapes: string[];
  fail_closed: boolean;
  tool_allow?: string[];
  tool_deny?: string[];
  /** Scan args/content for credential-shaped secrets. */
  scan_secrets?: boolean;
  /** Allow opt-out for intentional secret-handling tasks. */
  include_sensitive?: boolean;
}

/**
 * Default policy: network allows by default.
 * Opt into a restrictive network sample via SAMPLE_NETWORK_DENY_POLICY / sample-config.
 */
export const DEFAULT_POLICY: PolicyConfig = {
  protected_paths: ["**/prod/**", "**/.env*", "**/terraform.tfstate"],
  dangerous_shell_patterns: [
    String.raw`rm\s+-rf`,
    String.raw`chmod\s+777`,
    String.raw`curl.*\|\s*sh`,
    String.raw`wget.*\|\s*sh`,
    String.raw`chmod\s+-R`,
    String.raw`chown\s+-R`,
  ],
  network: { default: "allow", allow: [], deny: [] },
  permission_deny_shapes: ["*", "*:*", "AdministratorAccess"],
  fail_closed: true,
  scan_secrets: true,
  include_sensitive: false,
};

/**
 * Opt-in sample: deny-by-default egress with a small allowlist.
 * Not applied unless the user merges it into their config.
 */
export const SAMPLE_NETWORK_DENY_POLICY: NetworkPolicy = {
  default: "deny",
  allow: ["api.github.com"],
  deny: [],
};
