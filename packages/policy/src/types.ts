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
}

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
  network: { default: "deny", allow: ["api.github.com"] },
  permission_deny_shapes: ["*", "*:*", "AdministratorAccess"],
  fail_closed: true,
};
