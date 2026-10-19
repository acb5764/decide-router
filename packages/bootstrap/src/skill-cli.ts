#!/usr/bin/env node
import { installDecideRouterSkill } from "./skill-install.js";

const args = process.argv.slice(2);
const global = args.includes("--global") || args.includes("-g");
const yes = args.includes("--yes") || args.includes("-y") || true;
const rootArg = args.find((a) => !a.startsWith("-"));

const result = installDecideRouterSkill({
  root: rootArg,
  global,
  yes,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      skillVersion: result.skillVersion,
      installed: result.installed.map((t) => ({ id: t.id, path: t.path })),
      skipped: result.skipped,
      hint: "Skill teaches Decide-Router invocation only — not general debugging. Judgment ≠ permission.",
    },
    null,
    2,
  ),
);
