import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillInstallTarget {
  id: string;
  path: string;
  kind: "claude" | "cursor" | "agents" | "codex";
}

export interface SkillInstallOptions {
  /** Project root (default cwd). */
  root?: string;
  /** Also install under the user home skill dirs. */
  global?: boolean;
  /** Skip interactive prompts. */
  yes?: boolean;
  /** Override skill source directory. */
  skillSource?: string;
}

export interface SkillInstallResult {
  installed: SkillInstallTarget[];
  skipped: string[];
  skillVersion: string;
}

function defaultSkillSource(): string {
  // packages/bootstrap/src → repo root skills/decide-router
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../../skills/decide-router"),
    resolve(here, "../../../../skills/decide-router"),
    resolve(process.cwd(), "skills/decide-router"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "SKILL.md"))) return c;
  }
  return candidates[0]!;
}

/** Detect common agent skill directories (jg skill pattern). */
export function detectSkillTargets(
  root: string,
  globalInstall: boolean,
): SkillInstallTarget[] {
  const targets: SkillInstallTarget[] = [];
  const project = [
    {
      id: "claude-project",
      path: join(root, ".claude", "skills", "decide-router"),
      kind: "claude" as const,
    },
    {
      id: "agents-project",
      path: join(root, ".agents", "skills", "decide-router"),
      kind: "agents" as const,
    },
    {
      id: "cursor-project",
      path: join(root, ".cursor", "skills", "decide-router"),
      kind: "cursor" as const,
    },
  ];
  for (const t of project) {
    // Prefer installing where sibling agent dirs already exist, or always with --yes
    const parent = dirname(dirname(t.path));
    if (existsSync(parent) || existsSync(root)) targets.push(t);
  }

  if (globalInstall) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    if (home) {
      targets.push(
        {
          id: "claude-global",
          path: join(home, ".claude", "skills", "decide-router"),
          kind: "claude",
        },
        {
          id: "agents-global",
          path: join(home, ".agents", "skills", "decide-router"),
          kind: "agents",
        },
      );
    }
  }

  // Dedupe by path
  const seen = new Set<string>();
  return targets.filter((t) => {
    if (seen.has(t.path)) return false;
    seen.add(t.path);
    return true;
  });
}

export function installDecideRouterSkill(
  opts: SkillInstallOptions = {},
): SkillInstallResult {
  const root = resolve(opts.root ?? process.cwd());
  const source = opts.skillSource ?? defaultSkillSource();
  if (!existsSync(join(source, "SKILL.md"))) {
    throw new Error(`Skill source missing SKILL.md at ${source}`);
  }

  const skillMd = readFileSync(join(source, "SKILL.md"), "utf8");
  const skillVersion = "0.1.0";
  const targets = detectSkillTargets(root, Boolean(opts.global));
  const installed: SkillInstallTarget[] = [];
  const skipped: string[] = [];

  // With --yes install all detected; without, still install project targets
  // (non-interactive agent environments).
  const toInstall = opts.yes === false ? targets.slice(0, 1) : targets;

  for (const target of toInstall) {
    try {
      mkdirSync(target.path, { recursive: true });
      cpSync(join(source, "SKILL.md"), join(target.path, "SKILL.md"));
      writeFileSync(
        join(target.path, "skills-lock.json"),
        JSON.stringify(
          {
            name: "decide-router",
            version: skillVersion,
            source: "skills/decide-router",
            installedAt: new Date().toISOString(),
            note: "Rerun decide-router-skill to refresh. Does not configure credentials.",
          },
          null,
          2,
        ) + "\n",
      );
      installed.push(target);
    } catch (err) {
      skipped.push(
        `${target.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Also drop a pointer under .decide-router for bootstrap consumers
  try {
    const dr = join(root, ".decide-router");
    mkdirSync(dr, { recursive: true });
    writeFileSync(join(dr, "SKILL.md"), skillMd);
  } catch {
    /* best-effort */
  }

  return { installed, skipped, skillVersion };
}
