#!/usr/bin/env node
import { resolve } from "node:path";
import { runBootstrap } from "./run.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pathArg = args.find((a) => !a.startsWith("-")) ?? process.cwd();
  const write = args.includes("--write") || args.includes("-w") || true;
  const root = resolve(pathArg);

  const artifact = await runBootstrap({
    root,
    writeArtifacts: write,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        root: artifact.root,
        rules: artifact.rules.length,
        trees: artifact.trees.map((t) => t.id),
        instructionPreview: artifact.agentInstruction.split("\n").slice(0, 6),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
