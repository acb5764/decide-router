import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface IngestedFile {
  path: string;
  relativePath: string;
  content: string;
  kind:
    | "agents"
    | "claude"
    | "cursor_rule"
    | "preferences"
    | "contributing"
    | "decide_config"
    | "user_config"
    | "other";
}

const KNOWN: Array<{ match: RegExp; kind: IngestedFile["kind"] }> = [
  { match: /(^|\/)AGENTS\.md$/i, kind: "agents" },
  { match: /(^|\/)CLAUDE\.md$/i, kind: "claude" },
  { match: /(^|\/)preferences\.md$/i, kind: "preferences" },
  { match: /(^|\/)CONTRIBUTING\.md$/i, kind: "contributing" },
  { match: /(^|\/)decide-router\.config\.(ya?ml|json)$/i, kind: "decide_config" },
  { match: /\.cursor\/rules\//i, kind: "cursor_rule" },
  { match: /(^|\/)\.cursorrules$/i, kind: "cursor_rule" },
];

export const DEFAULT_GLOBS = [
  "AGENTS.md",
  "CLAUDE.md",
  "preferences.md",
  "CONTRIBUTING.md",
  "decide-router.config.yaml",
  "decide-router.config.yml",
  "decide-router.config.json",
  ".cursorrules",
];

/** Scan known preference/rule sources under a project root. */
export function ingestContextFiles(root: string): IngestedFile[] {
  const results: IngestedFile[] = [];
  const seen = new Set<string>();

  const add = (abs: string) => {
    if (seen.has(abs) || !existsSync(abs)) return;
    let st;
    try {
      st = statSync(abs);
    } catch {
      return;
    }
    if (!st.isFile()) return;
    const rel = relative(root, abs);
    const kind =
      KNOWN.find((k) => k.match.test(rel.replace(/\\/g, "/")))?.kind ?? "other";
    if (kind === "other" && !DEFAULT_GLOBS.some((g) => rel.endsWith(g))) {
      return;
    }
    seen.add(abs);
    results.push({
      path: abs,
      relativePath: rel,
      content: readFileSync(abs, "utf8"),
      kind,
    });
  };

  for (const name of DEFAULT_GLOBS) {
    add(join(root, name));
  }

  // .cursor/rules/**
  const rulesDir = join(root, ".cursor", "rules");
  if (existsSync(rulesDir)) {
    walk(rulesDir, (f) => {
      if (/\.(md|mdc|txt)$/i.test(f)) add(f);
    });
  }

  // Optional user config in home-relative path if present under root
  add(join(root, ".decide-router", "user.yaml"));
  add(join(root, ".decide-router", "user.json"));

  return results;
}

function walk(dir: string, onFile: (f: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    try {
      const st = statSync(p);
      if (st.isDirectory()) walk(p, onFile);
      else onFile(p);
    } catch {
      /* skip */
    }
  }
}
