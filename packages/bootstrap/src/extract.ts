import type { DecisionBackend, DecisionRequest } from "@decide-router/core";
import type {
  BootstrapRuleCandidate,
  BootstrapRuleLabel,
} from "@decide-router/trees";
import type { IngestedFile } from "./sources.js";

export const RULE_LABELS: BootstrapRuleLabel[] = [
  "hard_block",
  "ask_first",
  "prefer",
  "avoid",
  "tool_allow",
  "tool_deny",
  "path_protect",
  "network_allow",
  "style",
  "goal_constraint",
];

export const RULE_SCHEMA = {
  heads: {
    rule_label: RULE_LABELS as unknown as string[],
  },
};

export interface RawRuleCandidate {
  id: string;
  text: string;
  sourceFile: string;
  kind: IngestedFile["kind"];
}

/** Normalize ingested files into typed rule text candidates (pre-classify). */
export function normalizeRuleCandidates(files: IngestedFile[]): RawRuleCandidate[] {
  const out: RawRuleCandidate[] = [];
  let i = 0;
  for (const file of files) {
    if (file.kind === "decide_config") {
      // Pull policy-ish lines from yaml/json text
      for (const line of file.content.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        if (/protected|deny|allow|fail_closed|network|permission/i.test(t)) {
          out.push({
            id: `cfg-${i++}`,
            text: t.replace(/:\s*$/, "").slice(0, 300),
            sourceFile: file.relativePath,
            kind: file.kind,
          });
        }
      }
      continue;
    }

    const chunks = splitMarkdownRules(file.content);
    for (const chunk of chunks) {
      out.push({
        id: `r-${i++}`,
        text: chunk.slice(0, 500),
        sourceFile: file.relativePath,
        kind: file.kind,
      });
    }
  }
  return out;
}

function splitMarkdownRules(content: string): string[] {
  const lines = content.split("\n");
  const chunks: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join(" ").replace(/\s+/g, " ").trim();
    if (t.length >= 12) chunks.push(t);
    buf = [];
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    if (/^#{1,3}\s/.test(t)) {
      flush();
      continue;
    }
    if (/^[-*+]\s+/.test(t) || /^\d+\.\s+/.test(t)) {
      flush();
      chunks.push(t.replace(/^[-*+\d.]+\s+/, ""));
      continue;
    }
    buf.push(t);
  }
  flush();
  return chunks;
}

/** Classify candidates with Decide backends into closed rule labels. */
export async function extractRules(
  files: IngestedFile[],
  backend: DecisionBackend,
): Promise<BootstrapRuleCandidate[]> {
  const raw = normalizeRuleCandidates(files);
  const results: BootstrapRuleCandidate[] = [];

  for (const item of raw) {
    const request: DecisionRequest = {
      sessionId: "bootstrap",
      goal: "Extract project alignment rules into closed labels",
      event: "pre_tool",
      candidates: [...RULE_LABELS],
      context: {
        recentActions: [],
        toolName: "bootstrap",
        argsPreview: item.text,
      },
      schema: RULE_SCHEMA,
    };
    const scores = await backend.score(request);
    const head = scores.heads.rule_label;
    const label = (head?.label ?? "prefer") as BootstrapRuleLabel;
    results.push({
      id: item.id,
      text: item.text,
      label: RULE_LABELS.includes(label) ? label : "prefer",
      confidence: head?.confidence ?? scores.confidence,
      sourceFile: item.sourceFile,
    });
  }

  return results;
}
