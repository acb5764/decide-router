import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_HOME = process.env.CURSOR_AGENT_HOME || join(homedir(), ".cursor");
const HOOKS_DIR = join(AGENT_HOME, "hooks");
const DATA_DIR =
  process.env.DECIDE_ROUTER_DATA_DIR || join(AGENT_HOME, "decide-router");
const HOOKS_JSON = join(AGENT_HOME, "hooks.json");
const INSTALL_JSON = join(DATA_DIR, "install.json");
const HOOK_PREFIX = "decide-router-";

export interface HookEntry {
  command: string;
  timeout?: number;
  matcher?: string;
  [key: string]: unknown;
}

export interface HooksJson {
  version: number;
  hooks: Record<string, HookEntry[]>;
}

/**
 * Authorization gates only.
 * preCompact is advisory and is not wired as an authorization hook.
 * Shell/MCP are gated by beforeShellExecution / beforeMCPExecution — not preToolUse.
 */
export const DECIDE_ROUTER_HOOKS: Record<string, HookEntry[]> = {
  sessionStart: [
    { command: `./hooks/${HOOK_PREFIX}session-start.mjs`, timeout: 8 },
  ],
  beforeShellExecution: [
    { command: `./hooks/${HOOK_PREFIX}before-shell.mjs`, timeout: 6 },
  ],
  beforeMCPExecution: [
    { command: `./hooks/${HOOK_PREFIX}before-mcp.mjs`, timeout: 6 },
  ],
  preToolUse: [
    {
      command: `./hooks/${HOOK_PREFIX}pre-tool.mjs`,
      matcher: "Write|Delete|Edit|StrReplace",
      timeout: 7,
    },
  ],
  stop: [{ command: `./hooks/${HOOK_PREFIX}stop.mjs`, timeout: 5 }],
};

/** Optional advisory hook — not part of DECIDE_ROUTER_HOOKS install set. */
export const PRECOMPACT_ADVISORY_HOOK: HookEntry = {
  command: `./hooks/${HOOK_PREFIX}pre-compact.mjs`,
  timeout: 8,
};

function hookBasename(command: string): string {
  return basename(command.replace(/\\/g, "/"));
}

function isDecideRouterHook(entry: HookEntry): boolean {
  const name = hookBasename(entry.command);
  return name.startsWith(HOOK_PREFIX) && name.endsWith(".mjs");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function packageHandlersReady(
  packageRoot = PACKAGE_ROOT,
): Promise<boolean> {
  return pathExists(join(packageRoot, "dist", "handlers", "before-shell.js"));
}

async function packageVersion(): Promise<string> {
  const raw = await readFile(join(PACKAGE_ROOT, "package.json"), "utf8");
  const pkg = JSON.parse(raw) as { version?: string };
  return pkg.version ?? "0.0.0";
}

async function listHookFiles(): Promise<string[]> {
  const names = await readdir(join(PACKAGE_ROOT, "hooks"));
  return names
    .filter((n) => n.startsWith(HOOK_PREFIX) && n.endsWith(".mjs"))
    .sort();
}

export function upsertDecideRouterHooks(existing: HooksJson): HooksJson {
  const hooks: Record<string, HookEntry[]> = { ...existing.hooks };
  for (const [event, desired] of Object.entries(DECIDE_ROUTER_HOOKS)) {
    const current = [...(hooks[event] ?? [])];
    for (const entry of desired) {
      const name = hookBasename(entry.command);
      const idx = current.findIndex(
        (item) => hookBasename(item.command) === name,
      );
      if (idx >= 0) current[idx] = entry;
      else current.push(entry);
    }
    hooks[event] = current;
  }
  // Strip legacy preCompact authorization wiring if present
  if (hooks.preCompact) {
    hooks.preCompact = hooks.preCompact.filter(
      (e) => !hookBasename(e.command).includes("decide-router-pre-compact"),
    );
    if (!hooks.preCompact.length) delete hooks.preCompact;
  }
  return { version: existing.version || 1, hooks };
}

export function stripDecideRouterHooks(existing: HooksJson): HooksJson {
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, entries] of Object.entries(existing.hooks ?? {})) {
    const kept = entries.filter((e) => !isDecideRouterHook(e));
    if (kept.length) hooks[event] = kept;
  }
  return { version: existing.version || 1, hooks };
}

async function readHooksJson(): Promise<HooksJson | null> {
  try {
    const raw = await readFile(HOOKS_JSON, "utf8");
    const parsed = JSON.parse(raw) as HooksJson;
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      hooks:
        parsed.hooks && typeof parsed.hooks === "object" ? parsed.hooks : {},
    };
  } catch {
    return null;
  }
}

async function writeHooksJson(doc: HooksJson): Promise<void> {
  await writeFile(HOOKS_JSON, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

/** Install user-global hooks + compiled handlers into ~/.cursor */
export async function installUserAssets(): Promise<void> {
  const distSrc = join(PACKAGE_ROOT, "dist");
  const handlersReady = await packageHandlersReady();
  if (!handlersReady) {
    throw new Error(
      `Refuse to merge hooks.json: ${join(distSrc, "handlers")} missing. Run \`pnpm build\` in the Decide-Router package first.`,
    );
  }

  await mkdir(HOOKS_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  const installed: string[] = [];

  for (const name of await listHookFiles()) {
    const dest = join(HOOKS_DIR, name);
    await copyFile(join(PACKAGE_ROOT, "hooks", name), dest);
    await chmod(dest, 0o755);
    installed.push(dest);
    console.log(`installed ${dest}`);
  }
  const libDest = join(HOOKS_DIR, "decide-router-lib.mjs");
  await copyFile(join(PACKAGE_ROOT, "hooks", "decide-router-lib.mjs"), libDest);
  await chmod(libDest, 0o755);
  installed.push(libDest);

  const distDest = join(DATA_DIR, "dist");
  await rm(distDest, { recursive: true, force: true });
  await cp(distSrc, distDest, { recursive: true });
  installed.push(distDest);
  console.log(`installed ${distDest}`);

  await copyFile(
    join(PACKAGE_ROOT, "package.json"),
    join(DATA_DIR, "package.json"),
  );

  const cfgDest = join(DATA_DIR, "decide-router.config.yaml");
  if (!(await pathExists(cfgDest))) {
    const sample = join(PACKAGE_ROOT, "sample-config.yaml");
    if (await pathExists(sample)) await copyFile(sample, cfgDest);
  }

  const current = (await readHooksJson()) ?? { version: 1, hooks: {} };
  const had = Boolean(current.hooks && Object.keys(current.hooks).length);
  await writeHooksJson(upsertDecideRouterHooks(current));
  console.log(had ? `merged ${HOOKS_JSON}` : `wrote ${HOOKS_JSON}`);

  const manifest = {
    version: await packageVersion(),
    installedAt: new Date().toISOString(),
    files: installed,
    hooks: Object.keys(DECIDE_ROUTER_HOOKS),
    handlersReady: true,
    failOpen: true,
  };
  await writeFile(INSTALL_JSON, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${INSTALL_JSON}`);
  console.log(
    "Done. Authorization hooks: sessionStart, beforeShellExecution, beforeMCPExecution, preToolUse (non-shell/MCP), stop. Fail open if handlers crash.",
  );
}

export async function uninstallUserAssets(): Promise<void> {
  for (const name of await listHookFiles()) {
    const dest = join(HOOKS_DIR, name);
    await rm(dest, { force: true });
    console.log(`removed ${dest}`);
  }
  await rm(join(HOOKS_DIR, "decide-router-lib.mjs"), { force: true });
  await rm(join(DATA_DIR, "dist"), { recursive: true, force: true });

  const current = await readHooksJson();
  if (current) {
    await writeHooksJson(stripDecideRouterHooks(current));
    console.log(`stripped decide-router entries from ${HOOKS_JSON}`);
  }
  await rm(INSTALL_JSON, { force: true });
  console.log(`removed ${INSTALL_JSON}`);
}

export async function statusUserAssets(): Promise<void> {
  const version = await packageVersion();
  let manifest: { version?: string; installedAt?: string } | null = null;
  try {
    manifest = JSON.parse(await readFile(INSTALL_JSON, "utf8")) as {
      version?: string;
      installedAt?: string;
    };
  } catch {
    manifest = null;
  }

  const files: Record<string, boolean> = {};
  for (const name of await listHookFiles()) {
    files[`hooks/${name}`] = await pathExists(join(HOOKS_DIR, name));
  }
  files["hooks/decide-router-lib.mjs"] = await pathExists(
    join(HOOKS_DIR, "decide-router-lib.mjs"),
  );
  files["hooks.json"] = await pathExists(HOOKS_JSON);
  const distOk = await pathExists(
    join(DATA_DIR, "dist", "handlers", "before-shell.js"),
  );
  files["decide-router/dist/handlers"] = distOk;

  const hooksJson = await readHooksJson();
  const decideHookCount = hooksJson
    ? Object.values(hooksJson.hooks).reduce(
        (n, entries) => n + entries.filter((e) => isDecideRouterHook(e)).length,
        0,
      )
    : 0;

  const unhealthy = decideHookCount > 0 && !distOk;
  const payload = {
    packageVersion: version,
    installedVersion: manifest?.version ?? null,
    installedAt: manifest?.installedAt ?? null,
    current: manifest?.version === version,
    decideHookCount,
    handlersReady: distOk,
    wiredEvents: Object.keys(DECIDE_ROUTER_HOOKS),
    note: "preCompact is advisory-only and is not an authorization hook",
    failOpen: true,
    unhealthy,
    unhealthyReason: unhealthy
      ? "hooks.json references decide-router but dist/handlers is missing — fail-open stubs only"
      : null,
    files,
    agentHome: AGENT_HOME,
    dataDir: DATA_DIR,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (unhealthy) process.exitCode = 1;
}
