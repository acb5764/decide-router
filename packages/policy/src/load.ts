import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { DEFAULT_POLICY, type PolicyConfig } from "./types.js";
import { mergePolicyOverlay } from "./engine.js";

export interface RootConfigFile {
  goal?: string;
  backends?: { primary?: string; fallback?: string };
  policy?: Partial<PolicyConfig>;
  decisions?: Record<string, unknown>;
  playbooks?: string[];
}

export function loadRootConfig(path: string): RootConfigFile {
  const raw = readFileSync(path, "utf8");
  if (path.endsWith(".json")) {
    return JSON.parse(raw) as RootConfigFile;
  }
  return parseYaml(raw) as RootConfigFile;
}

export function policyFromRootConfig(cfg: RootConfigFile): PolicyConfig {
  if (!cfg.policy) return { ...DEFAULT_POLICY };
  return mergePolicyOverlay(DEFAULT_POLICY, cfg.policy);
}

export function parsePolicyJson(json: string): PolicyConfig {
  const parsed = JSON.parse(json) as Partial<PolicyConfig>;
  return mergePolicyOverlay(DEFAULT_POLICY, parsed);
}

export function parsePolicyYaml(yamlText: string): PolicyConfig {
  const parsed = parseYaml(yamlText) as Partial<PolicyConfig>;
  return mergePolicyOverlay(DEFAULT_POLICY, parsed);
}
