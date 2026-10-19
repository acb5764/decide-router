#!/usr/bin/env node
/**
 * Shared fail-open loader for Decide-Router Cursor hooks.
 * Resolves installed package handlers; on any failure emits allow/empty.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const AGENT_HOME = process.env.CURSOR_AGENT_HOME || join(homedir(), ".cursor");
export const DATA_DIR =
  process.env.DECIDE_ROUTER_DATA_DIR || join(AGENT_HOME, "decide-router");

export async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function out(obj) {
  process.stdout.write(JSON.stringify(obj ?? {}));
}

function candidateRoots() {
  const here = dirname(fileURLToPath(import.meta.url));
  const roots = [];
  if (process.env.DECIDE_ROUTER_ROOT) roots.push(process.env.DECIDE_ROUTER_ROOT);
  roots.push(DATA_DIR);
  // Dev: packages/adapters-cursor/hooks → package root
  roots.push(join(here, ".."));
  // Monorepo checkout
  roots.push(join(here, "..", "..", ".."));
  return roots;
}

export async function loadHandler(name) {
  for (const root of candidateRoots()) {
    const candidates = [
      join(root, "dist", "handlers", `${name}.js`),
      join(root, "packages", "adapters-cursor", "dist", "handlers", `${name}.js`),
    ];
    for (const file of candidates) {
      if (!existsSync(file)) continue;
      const mod = await import(pathToFileURL(file).href);
      if (typeof mod.main === "function") return mod;
      if (typeof mod[camel(name)] === "function") {
        return {
          async main() {
            const { readStdinJson, writeHookResult } = await import(
              pathToFileURL(join(dirname(file), "..", "hook-protocol.js")).href
            ).catch(() => ({
              readStdinJson: readStdin,
              writeHookResult: out,
            }));
            const input = await readStdinJson();
            writeHookResult(await mod[camel(name)](input));
          },
        };
      }
    }
  }
  return null;
}

function camel(kebab) {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Run named handler; fail open with fallback JSON. */
export async function runHook(name, fallback) {
  try {
    const mod = await loadHandler(name);
    if (!mod?.main) {
      out(fallback);
      return;
    }
    await mod.main();
  } catch {
    out(fallback);
  }
}

export function readInstallManifest() {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, "install.json"), "utf8"));
  } catch {
    return null;
  }
}
